/**
 * Fetch and stage the external CLI tools that get bundled into MuxBox builds.
 *
 *   - MKVToolNix (mkvmerge, mkvinfo)  — GPL-2.0-or-later
 *   - opus-tools  (opusenc)           — BSD-2-Clause
 *
 * Sources (chosen so every CI target arch has a community/prebuilt binary):
 *
 *   win32-x64    Official portable 7z from mkvtoolnix.download + MSYS2
 *                mingw-w64-x86_64-opus-tools.
 *   win32-arm64  The same official x64 mkvtoolnix build (no arm64 release
 *                exists; runs under Windows 11 ARM emulation) + native MSYS2
 *                clang-aarch64 opus-tools.
 *   darwin/*     Official MKVToolNix DMG (Homebrew has no Intel-mac bottle)
 *                + Homebrew opus-tools bottles with their runtime closure,
 *                re-linked into a relocatable bin/lib layout and ad-hoc
 *                re-signed.
 *   linux/*      Homebrew bottles (x86_64/arm64), re-rpath'd to
 *                $ORIGIN/../lib via patchelf only when the verify run needs it.
 *
 * Output layout (picked up by electron-builder `extraResources` and by
 * `resolveTool()` at runtime):
 *
 *   buildResources/bin/<platform>-<arch>/bin/<tools and DLLs>
 *   buildResources/bin/<platform>-<arch>/lib/<dylibs|shared objects>   (nix)
 *   buildResources/bin/<platform>-<arch>/licenses/<license texts>
 *
 * Every download is checksum-verified, every executable is smoke-tested with
 * `--version` before the script succeeds, and versions are pinned — a pin
 * mismatch fails loudly so the constants below can be bumped on purpose.
 *
 * Usage: node scripts/fetch-external-tools.mjs [--arch x64|arm64] [--skip-verify]
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Pins — bump deliberately, CI fails if an upstream drifts.
// ---------------------------------------------------------------------------

const MKVTOOLNIX_VERSION = '102.0';
/** Official macOS DMG build revision (pinned via the upstream file name). */
const MKVTOOLNIX_MAC_BUILD = '2';
/** Upstream release index for the official macOS DMGs. */
const MACOS_RELEASES = 'https://mkvtoolnix.download/macos/releases';
const OPUS_TOOLS_PIN = '0.2';

/** MSYS2 opus-tools packages: root name, expected pkg file, sha256, mirrors. */
const MSYS2 = {
    x64: {
        repo: 'mingw64',
        rootName: 'mingw-w64-x86_64-opus-tools',
        pkgFilePart: 'opus-tools-0.2-5',
        sha256: '8e77df2b3e7febb5915373403070a14138fda2afd3c214d10302151f8ba12917',
        mirrors: [
            'https://repo.msys2.org/mingw/mingw64',
            'https://mirror.msys2.org/mingw/mingw64',
        ],
    },
    arm64: {
        repo: 'clangarm64',
        rootName: 'mingw-w64-clang-aarch64-opus-tools',
        pkgFilePart: 'opus-tools-0.2-5',
        sha256: 'aca9142d8b7d1b8f35cab8ebaf728afb30f3e7bb2d26c09ae57df2e44ecbd922',
        mirrors: [
            'https://repo.msys2.org/mingw/clangarm64',
            'https://mirror.msys2.org/mingw/clangarm64',
        ],
    },
};

/**
 * MSYS2 dependency packages we deliberately do not bundle. opusfile is the
 * decode side (used by opusdec/opusinfo, not by opusenc) — pruning it keeps
 * the gnutls/openssl closure out of the installer; the verify run catches a
 * wrong assumption immediately.
 */
const MSYS2_SKIP_DEPS = [/opusfile/];

/** License texts staged next to each architecture's binaries. */
const LICENSES = [
    {
        file: 'GPL-2.0.txt',
        urls: [
            'https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt',
            'https://raw.githubusercontent.com/spdx/license-list-data/main/text/GPL-2.0-only.txt',
        ],
    },
    {
        file: 'LGPL-2.1.txt',
        urls: [
            'https://www.gnu.org/licenses/old-licenses/lgpl-2.1.txt',
            'https://raw.githubusercontent.com/spdx/license-list-data/main/text/LGPL-2.1-only.txt',
        ],
    },
    {
        file: 'LGPL-3.0.txt',
        urls: [
            'https://www.gnu.org/licenses/lgpl-3.0.txt',
            'https://raw.githubusercontent.com/spdx/license-list-data/main/text/LGPL-3.0-only.txt',
        ],
    },
    {
        file: 'opus-tools-COPYING.txt',
        urls: [
            'https://raw.githubusercontent.com/xiph/opus-tools/master/COPYING',
            'https://gitlab.xiph.org/xiph/opus-tools/-/raw/master/COPYING',
        ],
    },
];

/** macOS bottle codenames, oldest first — we pick the oldest for max reach. */
const MACOS_TAGS = [
    'high_sierra', 'mojave', 'catalina', 'big_sur', 'monterey',
    'ventura', 'sonoma', 'sequoia', 'tahoe', 'golden_gate',
];

/** Tool inventory: formula/binary names and which stage provides them. */
const BREW_TOOLS = [
    { formula: 'mkvtoolnix', executables: ['mkvmerge', 'mkvinfo'] },
    { formula: 'opus-tools', executables: ['opusenc'] },
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function log(message) {
    console.log(`[fetch-external-tools] ${message}`);
}

/** Some origins (gnu.org) 403 requests using the default undici UA. */
const USER_AGENT = 'Mozilla/5.0 (compatible; MuxBox-build/1.0; +https://github.com/BoatsMcGee/MuxBox)';

function fail(message) {
    throw new Error(message);
}

function parseArgs(argv) {
    const args = { arch: process.arch, skipVerify: false, help: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--arch') {
            const value = argv[i + 1];
            if (value !== 'x64' && value !== 'arm64') {
                fail(`--arch must be x64 or arm64, got: ${value ?? '(missing)'}`);
            }
            args.arch = value;
            i += 1;
        } else if (arg === '--skip-verify') {
            args.skipVerify = true;
        } else if (arg === '--help' || arg === '-h') {
            args.help = true;
        } else {
            fail(`Unknown argument: ${arg}`);
        }
    }
    return args;
}

async function hashFile(file, algorithm) {
    return new Promise((resolve, reject) => {
        const hash = createHash(algorithm);
        createReadStream(file)
            .on('data', (chunk) => hash.update(chunk))
            .on('error', reject)
            .on('end', () => resolve(hash.digest('hex')));
    });
}

/** Download to disk (follows redirects). Returns the response content-type-free buffer only when `to` is omitted. */
async function download(url, to, headers = {}) {
    const response = await fetch(url, {headers: {'User-Agent': USER_AGENT, ...headers}});
    if (!response.ok || response.body === null) {
        fail(`GET ${url} failed: HTTP ${response.status}`);
    }
    if (to === undefined) {
        return Buffer.from(await response.arrayBuffer());
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(to));
    return undefined;
}

async function downloadText(url, headers = {}) {
    const response = await fetch(url, {headers: {'User-Agent': USER_AGENT, ...headers}});
    if (!response.ok) {
        fail(`GET ${url} failed: HTTP ${response.status}`);
    }
    return response.text();
}

/** Try each mirror in order until one yields the file. */
async function downloadFirst(urls, to) {
    let lastError;
    for (const url of urls) {
        try {
            await download(url, to);
            return;
        } catch (error) {
            lastError = error;
            log(`WARN: ${url} failed (${error instanceof Error ? error.message : String(error)}); trying next mirror`);
        }
    }
    throw lastError;
}

function run(cmd, args, options = {}) {
    return spawnSync(cmd, args, { encoding: 'utf8', ...options });
}

function runOk(cmd, args, options = {}) {
    const result = run(cmd, args, options);
    if (result.error) {
        fail(`${cmd} failed to start: ${result.error.message}`);
    }
    if (result.status !== 0) {
        fail(
            `${cmd} ${args.join(' ')} exited with ${result.status}\n`
            + `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
        );
    }
    return result;
}

/**
 * On Windows always use the bsdtar from System32. In CI the fetch step runs
 * under Git Bash, where `tar` resolves to GNU tar — which parses `C:\path`
 * as a remote `host:path` (`tar: Cannot connect to C: resolve failed`) and
 * cannot read 7z at all. System32 bsdtar handles drive-letter paths and
 * 7z/zstd/gz natively (locally verified against every archive this script
 * downloads).
 */
function tarExecutable() {
    if (process.platform === 'win32') {
        const systemTar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
        if (existsSync(systemTar)) {
            return systemTar;
        }
    }
    return 'tar';
}

async function extractArchive(archive, destDir) {
    await fs.mkdir(destDir, { recursive: true });
    const result = run(tarExecutable(), ['-xf', archive, '-C', destDir]);
    if (result.error || result.status !== 0) {
        fail(
            `Failed to extract ${archive} (status ${result.status}): `
            + `${result.stderr ?? result.error?.message ?? ''}. `
            + 'On Windows this uses the bsdtar shipped with Windows 10+.',
        );
    }
}

/**
 * Recursively list files. Symlinks are treated as leaves (never followed) so
 * Homebrew's self-referencing lib/ trees cannot loop; copies dereference them.
 */
async function walkFiles(dir) {
    const out = [];
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...await walkFiles(full));
        } else {
            out.push(full);
        }
    }
    return out;
}

async function copyInto(source, destDir) {
    const dest = path.join(destDir, path.basename(source));
    if (existsSync(dest)) {
        const [a, b] = await Promise.all([hashFile(source, 'sha256'), hashFile(dest, 'sha256')]);
        if (a === b) {
            return dest;
        }
        fail(`Conflicting file while staging ${source}: ${dest} already exists with different content`);
    }
    await fs.copyFile(source, dest);
    await fs.chmod(dest, 0o755);
    return dest;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/** Can the host execute binaries of `exeArch`? (Win/mac arm run x64 via emulation.) */
function hostCanRun(exeArch, hostArch) {
    if (exeArch === hostArch) {
        return true;
    }
    return hostArch === 'arm64' && exeArch === 'x64';
}

/**
 * Run `<exe> --version`. Cross-architecture hosts that physically cannot run
 * the binary only warn (manual cross-fetch); everything else is a hard error —
 * on CI every job verifies natively, so a missing DLL fails the build.
 */
function verifyTool(tool, skipVerify) {
    const { file, exeArch, name } = tool;
    const hostArch = process.arch;
    const canRun = hostCanRun(exeArch, hostArch);

    if (skipVerify) {
        return;
    }

    const result = run(file, ['--version'], { timeout: 60_000 });

    if (result.error) {
        if (!canRun) {
            log(`WARN: cannot verify ${name} (${exeArch} binary on ${hostArch} host): ${result.error.message}`);
            return;
        }
        fail(`${name} failed to spawn (${file}): ${result.error.message}`);
    }

    if (result.status !== 0) {
        const hint = process.platform === 'win32'
            ? ` (exit ${result.status} — 0xC0000135/-1073741515 or 0xC0000142/-1073741502 usually mean a missing DLL)`
            : '';
        if (!canRun) {
            log(`WARN: ${name} --version exited ${result.status} on non-runnable ${exeArch} binary; skipping`);
            return;
        }
        fail(`${name} --version exited ${result.status}${hint}\n${result.stderr ?? ''}`);
    }

    log(`verified ${name}: ${(result.stdout ?? '').trim().split('\n')[0]}`);
}

// ---------------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------------

async function stageLicenses(licenseDir) {
    await fs.mkdir(licenseDir, { recursive: true });
    for (const license of LICENSES) {
        const dest = path.join(licenseDir, license.file);
        if (existsSync(dest)) {
            continue;
        }
        let lastError;
        for (const url of license.urls) {
            try {
                const buffer = await download(url);
                if (buffer.length === 0) {
                    fail(`empty body from ${url}`);
                }
                await fs.writeFile(dest, buffer);
                break;
            } catch (error) {
                lastError = error;
            }
        }
        if (!existsSync(dest)) {
            fail(`Could not fetch license ${license.file}: ${lastError?.message ?? 'unknown error'}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Windows: MKVToolNix official portable 7z
// ---------------------------------------------------------------------------

async function stageWindowsMkvToolNix(context) {
    const base = `https://mkvtoolnix.download/windows/releases/${MKVTOOLNIX_VERSION}`;
    const fileName = `mkvtoolnix-64-bit-${MKVTOOLNIX_VERSION}.7z`;

    // The checksum file is versioned next to the release; the filename pin
    // above is what guarantees we fetch the intended version.
    const sums = await downloadText(`${base}/sha512sums.txt`);
    let expected;
    for (const line of sums.split(/\r?\n/)) {
        const match = line.match(/^([0-9a-fA-F]{128})\s+\*?(.+?)\s*$/);
        if (match && match[2] === fileName) {
            expected = match[1].toLowerCase();
            break;
        }
    }
    if (expected === undefined) {
        fail(`${fileName} not listed in ${base}/sha512sums.txt — upstream layout changed?`);
    }

    log(`downloading ${fileName}`);
    const archive = path.join(context.tmpDir, fileName);
    await download(`${base}/${fileName}`, archive);

    const actual = await hashFile(archive, 'sha512');
    if (actual !== expected) {
        fail(`sha512 mismatch for ${fileName}: expected ${expected}, got ${actual}`);
    }

    const extractDir = path.join(context.tmpDir, 'mkvtoolnix');
    await extractArchive(archive, extractDir);

    const files = await walkFiles(extractDir);
    const mkvmerge = files.find((f) => path.basename(f).toLowerCase() === 'mkvmerge.exe');
    const mkvinfo = files.find((f) => path.basename(f).toLowerCase() === 'mkvinfo.exe');
    if (mkvmerge === undefined || mkvinfo === undefined) {
        fail('mkvmerge.exe/mkvinfo.exe not found inside the MKVToolNix archive');
    }

    // The portable build colocates its DLLs with the executables. Ship every
    // root DLL except crypto/d3dcompiler (unused by the CLI — the verify run
    // proves the set is complete).
    const exeDir = path.dirname(mkvmerge);
    const dlls = (await walkFiles(exeDir))
        .filter((f) => path.dirname(f) === exeDir)
        .filter((f) => f.toLowerCase().endsWith('.dll'))
        .filter((f) => !/^(Qt6|libcrypto|libssl|d3dcompiler)/i.test(path.basename(f)));

    await copyInto(mkvmerge, context.binDir);
    await copyInto(mkvinfo, context.binDir);
    for (const dll of dlls) {
        await copyInto(dll, context.binDir);
    }

    // mkvmerge here is always the official x64 build — on win32-arm64 jobs it
    // runs under Windows 11 ARM's x64 emulation.
    context.tools.push(
        { name: 'mkvmerge', file: path.join(context.binDir, 'mkvmerge.exe'), exeArch: 'x64' },
        { name: 'mkvinfo', file: path.join(context.binDir, 'mkvinfo.exe'), exeArch: 'x64' },
    );
    log(`staged MKVToolNix ${MKVTOOLNIX_VERSION} (${dlls.length} DLLs)`);
}

// ---------------------------------------------------------------------------
// Windows: MSYS2 opus-tools (pacman database closure)
// ---------------------------------------------------------------------------

function parsePacmanDesc(text) {
    const sections = {};
    let key = null;
    const flush = () => {
        if (key !== null) {
            sections[key] = sections[key] ?? [];
        }
    };
    for (const line of text.split(/\r?\n/)) {
        const header = line.match(/^%([A-Z0-9_]+)%$/);
        if (header !== null) {
            key = header[1];
            sections[key] = sections[key] ?? [];
        } else if (key !== null) {
            sections[key].push(line);
        }
    }
    flush();

    const first = (name) => (sections[name] ?? []).map((l) => l.trim()).find((l) => l !== '');
    const filename = first('FILENAME');
    // Modern pacman dbs carry a bare hash under %SHA256SUM%; older/alternate
    // layouts list "<sha256>  <file>" lines under %SHA256SUMS%.
    const single = first('SHA256SUM');
    let sha256;
    if (single !== undefined && /^[0-9a-fA-F]{64}$/.test(single)) {
        sha256 = single.toLowerCase();
    } else {
        sha256 = (sections.SHA256SUMS ?? [])
            .map((line) => line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/))
            .filter((match) => match !== null && match[2].trim() === filename)
            .map((match) => match[1].toLowerCase())[0];
    }

    return {
        name: first('NAME'),
        filename,
        sha256,
        deps: (sections.DEPENDS ?? [])
            .map((line) => line.trim().replace(/[<>=].*$/, '').trim())
            .filter((name) => name !== ''),
    };
}

async function stageWindowsOpusenc(context) {
    const pin = MSYS2[context.arch];
    if (pin === undefined) {
        fail(`No MSYS2 pin for arch ${context.arch}`);
    }

    const dbUrls = pin.mirrors.map((base) => `${base}/${pin.repo}.db`);
    log(`downloading ${dbUrls[0]}`);
    const dbArchive = path.join(context.tmpDir, `${pin.repo}.db`);
    await downloadFirst(dbUrls, dbArchive);
    const dbDir = path.join(context.tmpDir, `${pin.repo}-db`);
    await extractArchive(dbArchive, dbDir);

    const packages = new Map();
    for (const descFile of await walkFiles(dbDir)) {
        if (path.basename(descFile) !== 'desc') {
            continue;
        }
        const parsed = parsePacmanDesc(await fs.readFile(descFile, 'utf8'));
        if (parsed.name !== undefined) {
            packages.set(parsed.name, parsed);
        }
    }

    const root = packages.get(pin.rootName);
    if (root === undefined) {
        fail(`${pin.rootName} not found in ${pin.repo}.db`);
    }
    if (root.filename === undefined || !root.filename.includes(pin.pkgFilePart)) {
        fail(
            `MSYS2 opus-tools version drift: expected filename containing `
            + `"${pin.pkgFilePart}", got "${root.filename}" — update the MSYS2 pins.`,
        );
    }
    if (root.sha256 !== pin.sha256) {
        fail(
            `MSYS2 opus-tools sha256 drift for ${root.filename}: expected `
            + `${pin.sha256}, got ${root.sha256 ?? '(none)'} — update the MSYS2 pins.`,
        );
    }

    // Transitive runtime closure; virtual deps that only *provide* names are
    // skipped (their real package enters the closure through another edge).
    const wanted = [];
    const seen = new Set([pin.rootName]);
    const queue = [...root.deps];
    while (queue.length > 0) {
        const name = queue.shift();
        if (seen.has(name)) {
            continue;
        }
        seen.add(name);
        if (MSYS2_SKIP_DEPS.some((pattern) => pattern.test(name))) {
            log(`skipping dependency ${name} (pinned skip list)`);
            continue;
        }
        const entry = packages.get(name);
        if (entry === undefined) {
            log(`WARN: dependency ${name} is virtual/absent in ${pin.repo}.db — relying on verify`);
            continue;
        }
        wanted.push(entry);
        queue.push(...entry.deps.filter((dep) => !seen.has(dep)));
    }

    const toFetch = [root, ...wanted];
    for (const [index, pkg] of toFetch.entries()) {
        if (pkg.sha256 === undefined || pkg.filename === undefined) {
            fail(`No FILENAME/SHA256SUMS for ${pkg.name} in ${pin.repo}.db`);
        }
        const urls = pin.mirrors.map((base) => `${base}/${pkg.filename}`);
        const archive = path.join(context.tmpDir, `msys-${index}-${pkg.filename}`);
        log(`downloading ${pkg.filename} (${index + 1}/${toFetch.length})`);
        await downloadFirst(urls, archive);
        const actual = await hashFile(archive, 'sha256');
        if (actual !== pkg.sha256) {
            fail(`sha256 mismatch for ${pkg.filename}: expected ${pkg.sha256}, got ${actual}`);
        }

        const extractDir = path.join(context.tmpDir, `msys-extract-${index}`);
        await extractArchive(archive, extractDir);
        const extracted = await walkFiles(extractDir);
        const isRoot = pkg.name === pin.rootName;

        for (const file of extracted) {
            const base = path.basename(file);
            const inBin = path.dirname(file) === extractDir
                || /[\\/]bin[\\/]/.test(file);
            if (isRoot && base.toLowerCase() === 'opusenc.exe') {
                await copyInto(file, context.binDir);
                continue;
            }
            if (base.toLowerCase().endsWith('.dll') && inBin) {
                await copyInto(file, context.binDir);
            }
        }
    }

    // Native on both Windows jobs: x64 pkg on the x64 job, arm64 on the arm job.
    context.tools.push({
        name: 'opusenc',
        file: path.join(context.binDir, 'opusenc.exe'),
        exeArch: context.arch,
    });
    log(`staged opusenc from MSYS2 ${pin.repo} (${toFetch.length} packages)`);
}

// ---------------------------------------------------------------------------
// macOS: official MKVToolNix DMG
// ---------------------------------------------------------------------------

/** DMG file name for a Mac arch, e.g. `MKVToolNix-102.0-2-arm64.dmg`. */
function macosDmgName(arch) {
    const slice = arch === 'arm64' ? 'arm64' : 'x86_64';
    return `MKVToolNix-${MKVTOOLNIX_VERSION}-${MKVTOOLNIX_MAC_BUILD}-${slice}.dmg`;
}

function macosDmgUrl(arch) {
    return `${MACOS_RELEASES}/${MKVTOOLNIX_VERSION}/${macosDmgName(arch)}`;
}

/**
 * Homebrew bottles mkvtoolnix for arm64 Macs only — there is no Intel-mac
 * bottle — so both Mac arches stage mkvmerge/mkvinfo from the official DMG
 * (the same official-binary approach as the Windows portable 7z). The CLI
 * tools reference their bundled dylibs as `@executable_path/libs/<name>`;
 * that closure is staged into lib/ here and rewritten to the shipped
 * `@executable_path/../lib` layout by rewriteMachoDependencies().
 */
async function stageMacMkvToolNix(context) {
    const fileName = macosDmgName(context.arch);
    const url = macosDmgUrl(context.arch);

    // Checksums ship next to the release (same pattern as the Windows 7z).
    const sumsUrl = `${MACOS_RELEASES}/${MKVTOOLNIX_VERSION}/sha256sums.txt`;
    const sums = await downloadText(sumsUrl);
    let expected;
    for (const line of sums.split(/\r?\n/)) {
        const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/);
        if (match && match[2] === fileName) {
            expected = match[1].toLowerCase();
            break;
        }
    }
    if (expected === undefined) {
        fail(`${fileName} not listed in ${sumsUrl} — upstream layout changed?`);
    }

    log(`downloading ${fileName}`);
    const dmg = path.join(context.tmpDir, fileName);
    await download(url, dmg);
    const actual = await hashFile(dmg, 'sha256');
    if (actual !== expected) {
        fail(`sha256 mismatch for ${fileName}: expected ${expected}, got ${actual}`);
    }

    let mountDir;
    try {
        const attach = runOk('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-plist']);
        const mountPoints = [...attach.stdout.matchAll(
            /<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g,
        )];
        mountDir = mountPoints.at(-1)?.[1];
        if (mountDir === undefined) {
            fail(`hdiutil attach of ${fileName} reported no mount point: ${attach.stdout}`);
        }

        const appMacOS = path.join(mountDir, 'MKVToolNix.app', 'Contents', 'MacOS');
        const libsDir = path.join(appMacOS, 'libs');

        // Executables, then the transitive dylib closure they reference.
        const queue = [];
        for (const name of ['mkvmerge', 'mkvinfo']) {
            const source = path.join(appMacOS, name);
            if (!existsSync(source)) {
                fail(`${name} not found in ${fileName} — upstream bundle layout changed?`);
            }
            const file = await copyInto(source, context.binDir);
            context.tools.push({name, file, exeArch: context.arch});
            queue.push(source);
        }

        let libCount = 0;
        while (queue.length > 0) {
            const file = queue.shift();
            for (const ref of machoDependencies(file)) {
                const match = /^@executable_path\/libs\/([^/]+)$/.exec(ref);
                if (match === null) {
                    continue;
                }
                const source = path.join(libsDir, match[1]);
                if (!existsSync(source)) {
                    fail(`Dependency ${ref} of ${path.basename(file)} missing in ${fileName}`);
                }
                if (existsSync(path.join(context.libDir, match[1]))) {
                    continue;
                }
                await copyInto(source, context.libDir);
                queue.push(source);
                libCount += 1;
            }
        }
        log(`staged MKVToolNix ${MKVTOOLNIX_VERSION} official ${context.arch} DMG (${libCount} dylibs)`);
    } finally {
        if (mountDir !== undefined) {
            let detach = run('hdiutil', ['detach', mountDir]);
            if (detach.status !== 0) {
                detach = run('hdiutil', ['detach', mountDir, '-force']);
            }
            if (detach.status !== 0) {
                log(`WARN: could not detach ${mountDir}: ${detach.stderr ?? detach.error?.message ?? ''}`);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// macOS / Linux: Homebrew bottles
// ---------------------------------------------------------------------------

async function brewFormula(name) {
    const url = `https://formulae.brew.sh/api/formula/${encodeURIComponent(name)}.json`;
    const buffer = await download(url);
    return JSON.parse(buffer.toString('utf8'));
}

function assertPinned(formula, pin) {
    const stable = formula.versions?.stable;
    // Accept a revision suffix (e.g. "0.2_2") but require the pinned version.
    if (stable !== pin && !stable?.startsWith(`${pin}_`)) {
        fail(
            `Homebrew ${formula.name} version drift: expected ${pin}, `
            + `got ${stable} — update the pins in fetch-external-tools.mjs.`,
        );
    }
}

/**
 * Bottle tag for the given platform/arch (overridable for tests). Some
 * formulae — e.g. ca-certificates — publish only an arch-independent bottle
 * tagged `all`; it is accepted whenever no platform-specific tag exists.
 */
function pickBottleTag(formula, platform = process.platform, arch = process.arch) {
    const files = formula.bottle?.stable?.files;
    if (files === undefined) {
        fail(`Homebrew ${formula.name} publishes no bottles`);
    }
    const candidates = Object.keys(files);

    if (platform === 'linux') {
        const wanted = arch === 'arm64' ? 'arm64_linux' : 'x86_64_linux';
        if (files[wanted] === undefined) {
            if (files.all !== undefined) {
                return 'all';
            }
            fail(`Homebrew ${formula.name} has no ${wanted} bottle (have: ${candidates.join(', ')})`);
        }
        return wanted;
    }

    const prefix = arch === 'arm64' ? 'arm64_' : '';
    const archCandidates = candidates.filter((tag) =>
        tag !== 'all'
        && (arch === 'arm64' ? tag.startsWith('arm64_') : !tag.startsWith('arm64_'))
        && !tag.endsWith('_linux'));
    if (archCandidates.length === 0) {
        if (files.all !== undefined) {
            return 'all';
        }
        fail(`Homebrew ${formula.name} has no ${arch} bottle`);
    }
    // Oldest macOS tag available → widest compatibility with newer systems.
    for (const codename of MACOS_TAGS) {
        const tag = `${prefix}${codename}`;
        if (archCandidates.includes(tag)) {
            return tag;
        }
    }
    const fallback = archCandidates[0];
    log(`WARN: ${formula.name} has no tag in the known codename order, using ${fallback}`);
    return fallback;
}

/**
 * Registry repository path of a bottle blob URL, e.g.
 * `https://ghcr.io/v2/homebrew/core/icu4c/78/blobs/sha256:…` →
 * `homebrew/core/icu4c/78`. Versioned formulae (`icu4c@78`) publish under a
 * `/`-separated path, NOT their formula name — a scope built from
 * `homebrew/core/icu4c@78` is rejected by ghcr.io with HTTP 400.
 * Returns null for URLs we don't recognize.
 */
function repositoryFromBottleUrl(fileUrl) {
    let pathname;
    try {
        pathname = new URL(fileUrl).pathname;
    } catch {
        return null;
    }
    const match = /^\/v2\/(.+)\/blobs\/sha256:[0-9a-f]+$/.exec(pathname);
    return match === null ? null : match[1];
}

async function downloadBottle(formula, tag, destDir) {
    const file = formula.bottle.stable.files[tag];
    const repository = repositoryFromBottleUrl(file.url) ?? `homebrew/core/${formula.name}`;
    const scope = `repository:${repository}:pull`;
    const tokenResponse = await fetch(
        `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`,
        {headers: {'User-Agent': USER_AGENT}},
    );
    if (!tokenResponse.ok) {
        fail(`ghcr.io token request failed: HTTP ${tokenResponse.status} (scope: ${scope})`);
    }
    const { token } = JSON.parse(await tokenResponse.text());

    const archive = path.join(destDir, `${formula.name}-${tag}.tar.gz`);
    await download(file.url, archive, { Authorization: `Bearer ${token}` });
    const actual = await hashFile(archive, 'sha256');
    if (actual !== file.sha256) {
        fail(`sha256 mismatch for ${formula.name} bottle (${tag}): expected ${file.sha256}, got ${actual}`);
    }
    const extractDir = path.join(destDir, `${formula.name}-${tag}`);
    await extractArchive(archive, extractDir);
    return extractDir;
}

/** Runtime dependency closure via the formula API (runtime deps only). */
async function brewClosure(rootNames) {
    const closure = new Map();
    const queue = [...rootNames];
    while (queue.length > 0) {
        const name = queue.shift();
        if (closure.has(name)) {
            continue;
        }
        const formula = await brewFormula(name);
        closure.set(name, formula);
        for (const dep of formula.dependencies ?? []) {
            if (!closure.has(dep)) {
                queue.push(dep);
            }
        }
    }
    return closure;
}

async function stageBrewTools(context, formulaNames = BREW_TOOLS.map((tool) => tool.formula)) {
    const rootNames = formulaNames;
    const rootFormulas = new Map();
    for (const name of rootNames) {
        const formula = await brewFormula(name);
        const pin = name === 'mkvtoolnix' ? MKVTOOLNIX_VERSION : OPUS_TOOLS_PIN;
        assertPinned(formula, pin);
        rootFormulas.set(name, formula);
    }

    const closure = await brewClosure(rootNames);
    const stagingRoot = path.join(context.tmpDir, 'bottles');
    await fs.mkdir(stagingRoot, {recursive: true});

    const extractDirs = new Map();
    for (const [name, formula] of closure) {
        const tag = pickBottleTag(formula);
        log(`downloading ${name} bottle (${tag})`);
        extractDirs.set(name, await downloadBottle(formula, tag, stagingRoot));
    }

    // Executables from the requested root formulae.
    for (const tool of BREW_TOOLS) {
        if (!rootNames.includes(tool.formula)) {
            continue;
        }
        const extractDir = extractDirs.get(tool.formula);
        const files = await walkFiles(extractDir);
        for (const executable of tool.executables) {
            const found = files.find((file) => file.endsWith(`${path.sep}bin${path.sep}${executable}`));
            if (found === undefined) {
                fail(`${executable} not found in the ${tool.formula} bottle`);
            }
            const dest = await copyInto(found, context.binDir);
            if (process.platform !== 'win32') {
                await fs.chmod(dest, 0o755);
            }
            context.tools.push({name: executable, file: dest, exeArch: context.arch});
        }
    }

    // Runtime libraries from every formula in the closure — flattened into
    // lib/ (Homebrew only ever ships soname-versioned files at lib/ top level,
    // so basenames do not collide across formulae).
    let libCount = 0;
    for (const extractDir of extractDirs.values()) {
        const files = await walkFiles(extractDir);
        for (const file of files) {
            const relative = file.slice(extractDir.length);
            if (/[\\/]lib[\\/][^\\/]+$/.test(relative)) {
                await copyInto(file, context.libDir);
                libCount += 1;
            }
        }
    }
    log(`staged ${libCount} library files from ${extractDirs.size} bottles`);
}

// ---------------------------------------------------------------------------
// macOS post-processing: re-link into bin/../lib and ad-hoc sign
// ---------------------------------------------------------------------------

function machoDependencies(file) {
    const result = run('otool', ['-L', file]);
    if (result.error || result.status !== 0) {
        fail(`otool -L failed for ${file}: ${result.stderr ?? result.error?.message ?? ''}`);
    }
    return result.stdout
        .split('\n')
        .slice(1)
        .map((line) => line.trim().split(/\s+\(/)[0])
        .filter((line) => line !== '');
}

function machoRpaths(file) {
    const result = run('otool', ['-l', file]);
    if (result.error || result.status !== 0) {
        fail(`otool -l failed for ${file}: ${result.stderr ?? result.error?.message ?? ''}`);
    }
    const rpaths = [];
    for (const line of result.stdout.split('\n')) {
        const match = line.match(/^\s*path\s+(\S+)\s+\(offset/);
        if (match !== null) {
            rpaths.push(match[1]);
        }
    }
    return rpaths;
}

function isSystemRef(ref) {
    return ref.startsWith('@')
        || ref.startsWith('/usr/lib/')
        || ref.startsWith('/System/')
        || ref.startsWith('/usr/libexec/');
}

function isBrewRef(ref) {
    return ref.startsWith('/opt/homebrew/')
        || ref.startsWith('/usr/local/')
        || ref.includes('/Cellar/');
}

async function rewriteMachoDependencies(context) {
    const targets = [
        ...context.tools.map((tool) => ({file: tool.file, isExe: true})),
        ...(await walkFiles(context.libDir)).map((file) => ({file, isExe: false})),
    ];

    for (const {file, isExe} of targets) {
        let modified = false;

        for (const ref of machoDependencies(file)) {
            // Official MKVToolNix DMG: dylibs live in Contents/MacOS/libs;
            // the shipped layout keeps them in ../lib next to the binaries.
            const dmgRef = /^@executable_path\/libs\/([^/]+)$/.exec(ref);
            if (dmgRef !== null) {
                const base = dmgRef[1];
                if (!existsSync(path.join(context.libDir, base))) {
                    fail(`Dependency "${ref}" of ${file} has no staged library ${base} in lib/`);
                }
                const replacement = isExe
                    ? `@executable_path/../lib/${base}`
                    : `@loader_path/${base}`;
                runOk('install_name_tool', ['-change', ref, replacement, file]);
                modified = true;
                continue;
            }
            if (isSystemRef(ref)) {
                continue;
            }
            if (!isBrewRef(ref)) {
                fail(`Unhandled absolute dependency "${ref}" in ${file}`);
            }
            const base = path.posix.basename(ref);
            if (!existsSync(path.join(context.libDir, base))) {
                fail(`Dependency "${ref}" of ${file} has no staged library ${base} in lib/`);
            }
            const replacement = isExe
                ? `@executable_path/../lib/${base}`
                : `@loader_path/${base}`;
            runOk('install_name_tool', ['-change', ref, replacement, file]);
            modified = true;
        }

        for (const rpath of machoRpaths(file)) {
            if (isSystemRef(rpath) || !isBrewRef(rpath)) {
                continue;
            }
            const replacement = isExe ? '@executable_path/../lib' : '@loader_path';
            runOk('install_name_tool', ['-rpath', rpath, replacement, file]);
            modified = true;
        }

        if (modified) {
            // install_name_tool invalidates the ad-hoc signature; arm64 macOS
            // refuses unsigned/invalidly-signed binaries.
            runOk('codesign', ['--force', '--sign', '-', file]);
            log(`relinked + re-signed ${path.basename(file)}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Linux post-processing: $ORIGIN rpaths (patchelf) when the verify run needs it
// ---------------------------------------------------------------------------

async function ensurePatchelf() {
    const probe = run('patchelf', ['--version']);
    if (!probe.error && probe.status === 0) {
        return;
    }
    log('patchelf missing — installing via apt-get (needed to relocate Homebrew bottles)');
    runOk('sudo', ['apt-get', 'update', '-qq']);
    runOk('sudo', ['apt-get', 'install', '-y', '-qq', 'patchelf']);
}

async function applyLinuxRpaths(context) {
    await ensurePatchelf();

    const normalizeNeeded = (file) => {
        const printed = run('patchelf', ['--print-needed', file]);
        if (printed.error || printed.status !== 0) {
            return; // Not an ELF object with a dynamic section we can fix.
        }
        for (const needed of printed.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '')) {
            if (!needed.startsWith('/')) {
                continue;
            }
            const base = path.posix.basename(needed);
            if (!existsSync(path.join(context.libDir, base))) {
                fail(`NEEDED "${needed}" of ${file} has no staged library ${base} in lib/`);
            }
            runOk('patchelf', ['--replace-needed', needed, base, file]);
        }
    };

    const binFiles = (await walkFiles(context.binDir)).filter((f) => !f.endsWith('.dll'));
    for (const file of binFiles) {
        runOk('patchelf', ['--set-rpath', '$ORIGIN/../lib', file]);
        normalizeNeeded(file);
    }
    for (const file of await walkFiles(context.libDir)) {
        runOk('patchelf', ['--set-rpath', '$ORIGIN', file]);
        normalizeNeeded(file);
    }
    log('applied $ORIGIN rpaths');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log('Usage: node scripts/fetch-external-tools.mjs [--arch x64|arm64] [--skip-verify]');
        return;
    }

    const platform = process.platform;
    if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
        fail(`Unsupported platform: ${platform}`);
    }

    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = path.dirname(scriptDir);
    const archDir = `${platform}-${args.arch}`;

    const context = {
        platform,
        arch: args.arch,
        tools: [],
        outDir: path.join(projectRoot, 'buildResources', 'bin', archDir),
        tmpDir: await fs.mkdtemp(path.join(tmpdir(), 'muxbox-tools-')),
        skipVerify: args.skipVerify,
    };
    context.binDir = path.join(context.outDir, 'bin');
    context.libDir = path.join(context.outDir, 'lib');
    context.licenseDir = path.join(context.outDir, 'licenses');

    let succeeded = false;
    try {
        log(`staging tools for ${archDir} (host: ${platform}/${process.arch})`);
        // Restage from scratch: leftovers from a previous run (or files from a
        // package no longer in the closure) must never conflict with the
        // current download or ship stale binaries via extraResources.
        await fs.rm(context.outDir, {recursive: true, force: true});
        await fs.mkdir(context.binDir, {recursive: true});
        await stageLicenses(context.licenseDir);

        if (platform === 'win32') {
            await stageWindowsMkvToolNix(context);
            await stageWindowsOpusenc(context);
        } else {
            await fs.mkdir(context.libDir, {recursive: true});
            if (platform === 'darwin') {
                // mkvtoolnix ships via the official DMG on both Mac arches
                // (Homebrew has no Intel-mac bottle); opusenc stays on bottles.
                await stageMacMkvToolNix(context);
                await stageBrewTools(context, ['opus-tools']);
                await rewriteMachoDependencies(context);
            } else {
                await stageBrewTools(context);
            }
        }

        const verifyOnce = () => {
            for (const tool of context.tools) {
                verifyTool(tool, context.skipVerify);
            }
        };

        try {
            verifyOnce();
        } catch (error) {
            if (platform !== 'linux' || context.skipVerify) {
                throw error;
            }
            // Homebrew bottles may hardcode their Cellar rpath; once relocated
            // next to our lib/ they only run after switching to $ORIGIN.
            log(`verify failed — applying $ORIGIN rpaths and retrying (${error instanceof Error ? error.message : String(error)})`);
            await applyLinuxRpaths(context);
            verifyOnce();
        }

        log(`done: ${context.tools.length} executables staged in ${path.relative(projectRoot, context.outDir)}`);
        succeeded = true;
    } finally {
        if (succeeded) {
            await fs.rm(context.tmpDir, {recursive: true, force: true});
        } else {
            log(`kept temp dir for inspection: ${context.tmpDir}`);
        }
    }
}

const invokedDirectly = process.argv[1] !== undefined
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    main().catch((error) => {
        console.error(`[fetch-external-tools] FAILED: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
}

export {
    main as fetchExternalTools,
    macosDmgName,
    macosDmgUrl,
    pickBottleTag,
    repositoryFromBottleUrl,
    tarExecutable,
};
