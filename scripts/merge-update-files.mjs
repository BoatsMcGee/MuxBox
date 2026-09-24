/**
 * Merge the per-CI-job update metadata files produced by electron-builder.
 *
 * Each compile job (Windows x64/arm64, macOS x64/arm64) builds in isolation
 * and therefore writes its own channel file (`latest.yml` / `beta.yml` /
 * `nightly.yml`, plus the `-mac`/`-linux` variants). Because electron-updater
 * selects its artifact by matching `process.arch` inside the `files[]` url
 * list, a single release asset listing *all* architectures is the correct
 * publish format — this script unions those lists instead of letting artifact
 * downloads clobber one arch with another.
 *
 * Strategy: the first input directory (deterministic alphabetical order)
 * provides the base document; every same-named channel file contributes its
 * `files[]` entries (deduped by `url`). Non-metadata artifacts are unique per
 * job by construction (arch is part of the artifact name) and are copied
 * through, with a hard error on any conflicting duplicate.
 *
 * The merged document is emitted in the same flat YAML shape
 * electron-builder writes (and electron-updater parses via js-yaml).
 *
 * Usage: node scripts/merge-update-files.mjs <partsDir> <outDir>
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Unquote a YAML scalar (plain, 'single', or "double"). */
function unquote(raw) {
    const value = raw.trim();
    if (value.length >= 2 && value.startsWith('\'') && value.endsWith('\'')) {
        return value.slice(1, -1).replace(/''/g, '\'');
    }
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return value;
}

/** Quote only when the value is not a safe YAML plain scalar for our data. */
function quote(raw) {
    return /^[\w./+=-]+$/.test(raw) ? raw : `'${raw.replace(/'/g, '\'\'')}'`;
}

/**
 * Parse the `files:` sequence of an electron-builder update-info document.
 * Throws on structural surprises — we would rather fail the release than
 * publish subtly wrong metadata.
 */
function parseYamlFilesBlock(text) {
    const lines = text.split('\n');
    const start = lines.findIndex((line) => line === 'files:');
    if (start === -1) {
        throw new Error('channel file has no top-level "files:" block');
    }

    const files = [];
    let current = null;
    for (let i = start + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.trim() === '') {
            continue;
        }
        if (!line.startsWith('  ')) {
            break; // next top-level key
        }
        const item = line.match(/^ {2}- url:\s*(.*)$/);
        if (item !== null) {
            current = {url: unquote(item[1])};
            files.push(current);
            continue;
        }
        const prop = line.match(/^ {4}(\w+):\s*(.*)$/);
        if (prop !== null && current !== null) {
            current[prop[1]] = unquote(prop[2]);
            continue;
        }
        throw new Error(`unexpected line in files block: ${JSON.stringify(line)}`);
    }

    if (files.length === 0) {
        throw new Error('"files:" block is empty');
    }
    for (const file of files) {
        if (typeof file.url !== 'string' || typeof file.sha512 !== 'string') {
            throw new Error(`files entry is missing url/sha512: ${JSON.stringify(file)}`);
        }
    }
    return {lines, files, start};
}

function renderYamlFilesBlock(files) {
    const out = ['files:'];
    for (const file of files) {
        out.push(`  - url: ${quote(file.url)}`);
        out.push(`    sha512: ${quote(file.sha512)}`);
        if (typeof file.size === 'string' || typeof file.size === 'number') {
            out.push(`    size: ${file.size}`);
        }
    }
    return out;
}

/** Union `files[]` into `base`, keeping the base entries first. */
function mergeChannelText(baseText, otherTexts) {
    const base = parseYamlFilesBlock(baseText);
    const baseVersion = baseText.match(/^version:\s*(\S+)\s*$/m)?.[1];
    if (baseVersion === undefined) {
        throw new Error('channel file has no top-level "version:" key');
    }

    const merged = [...base.files];
    const seen = new Set(merged.map((file) => file.url));

    for (const text of otherTexts) {
        const version = text.match(/^version:\s*(\S+)\s*$/m)?.[1];
        if (version !== baseVersion) {
            throw new Error(`version mismatch across jobs: ${baseVersion} vs ${version ?? '(missing)'}`);
        }
        const parsed = parseYamlFilesBlock(text);
        for (const file of parsed.files) {
            if (!seen.has(file.url)) {
                seen.add(file.url);
                merged.push(file);
            }
        }
    }

    const block = renderYamlFilesBlock(merged);
    const blockEnd = endOfBlock(base.lines, base.start);
    return [
        ...base.lines.slice(0, base.start),
        ...block,
        ...base.lines.slice(blockEnd),
    ].join('\n');
}

/** Find the line index where the `files:` block ends. */
function endOfBlock(lines, start) {
    let i = start + 1;
    while (i < lines.length && (lines[i].startsWith('  ') || lines[i].trim() === '')) {
        i += 1;
    }
    return i;
}

async function collectDirs(root) {
    const entries = await fs.readdir(root, {withFileTypes: true});
    const dirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .sort(); // deterministic primary: first dir wins ties
    if (dirs.length === 0) {
        throw new Error(`no artifact directories inside ${root}`);
    }
    return dirs;
}

async function mergeUpdateFiles(partsDir, outDir) {
    const dirs = await collectDirs(partsDir);
    await fs.mkdir(outDir, {recursive: true});

    // Group channel files by file name across directories.
    const ymlGroups = new Map();
    const plainFiles = new Map();

    for (const dir of dirs) {
        for (const name of (await fs.readdir(dir)).sort()) {
            const full = path.join(dir, name);
            const stat = await fs.stat(full);
            if (!stat.isFile()) {
                continue;
            }
            if (name === 'builder-debug.yml') {
                continue; // electron-builder debug dump — never publish
            }
            if (name.endsWith('.yml')) {
                const group = ymlGroups.get(name) ?? [];
                group.push(full);
                ymlGroups.set(name, group);
            } else {
                const group = plainFiles.get(name) ?? [];
                group.push(full);
                plainFiles.set(name, group);
            }
        }
    }

    for (const [name, sources] of plainFiles) {
        if (sources.length === 1) {
            await fs.copyFile(sources[0], path.join(outDir, name));
            continue;
        }
        const [first, ...rest] = sources;
        const firstHash = await hashOf(first);
        for (const other of rest) {
            if (await hashOf(other) !== firstHash) {
                throw new Error(`conflicting artifact ${name} with different content across jobs`);
            }
        }
        await fs.copyFile(first, path.join(outDir, name));
    }

    for (const [name, sources] of ymlGroups) {
        const [base, ...others] = sources;
        const baseText = await fs.readFile(base, 'utf8');
        const otherTexts = await Promise.all(
            others.map((file) => fs.readFile(file, 'utf8')),
        );
        const merged = otherTexts.length === 0
            ? baseText
            : mergeChannelText(baseText, otherTexts);
        await fs.writeFile(path.join(outDir, name), merged, 'utf8');
    }

    return {
        channels: [...ymlGroups.keys()].sort(),
        artifacts: [...plainFiles.keys()].sort(),
        directories: dirs,
    };
}

async function hashOf(file) {
    const {createHash} = await import('node:crypto');
    const {createReadStream} = await import('node:fs');
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        createReadStream(file)
            .on('data', (chunk) => hash.update(chunk))
            .on('error', reject)
            .on('end', () => resolve(hash.digest('hex')));
    });
}

const invokedDirectly = process.argv[1] !== undefined
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    const [partsDir, outDir] = process.argv.slice(2);
    if (partsDir === undefined || outDir === undefined) {
        console.error('Usage: node scripts/merge-update-files.mjs <partsDir> <outDir>');
        process.exitCode = 1;
    } else {
        mergeUpdateFiles(partsDir, outDir)
            .then((summary) => {
                console.log(
                    `[merge-update-files] merged ${summary.channels.length} channel file(s) `
                    + `and copied ${summary.artifacts.length} artifact(s) from `
                    + `${summary.directories.length} job(s)`,
                );
            })
            .catch((error) => {
                console.error(`[merge-update-files] FAILED: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            });
    }
}

export {mergeUpdateFiles, mergeChannelText, parseYamlFilesBlock};
