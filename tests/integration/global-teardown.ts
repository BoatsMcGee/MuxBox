/**
 * Playwright global teardown — runs after ALL tests.
 *
 * On success (failure marker absent):
 *   1. Encode every temporary PNG screenshot to 1920x1080 AVIF
 *      (bundled FFmpeg, libsvtav1 — no extra dependencies) into a staging dir.
 *   2. Swap staging into `media/screenshots` (full replace so stale
 *      screenshots from older runs disappear).
 *   3. Delete `media/screenshots-temporary` and `tests/integration/appdata`
 *      so the next run starts clean.
 *
 * On failure everything is kept for inspection.
 */
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, renameSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {ffmpegPath} from 'node-av/ffmpeg';
import {APPDATA_DIR, RUN_FAILED_MARKER, SCREENSHOTS_DIR, SCREENSHOTS_TEMP_DIR} from './global-setup';

const TARGET_WIDTH = 1920;
const TARGET_HEIGHT = 1080;
const STAGING_DIR = path.join(process.cwd(), 'media', '.screenshots-staging');

function runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(ffmpegPath(), args, {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
        let stderr = '';
        proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exited with code ${code}:\n${args.join(' ')}\n${stderr.slice(-3000)}`));
        });
    });
}

/** Read PNG dimensions straight from the IHDR chunk. */
function pngSize(file: string): {width: number; height: number} {
    const buf = readFileSync(file);
    if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') {
        throw new Error(`Not a PNG: ${file}`);
    }
    return {width: buf.readUInt32BE(16), height: buf.readUInt32BE(20)};
}

function walkPngs(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkPngs(full, out);
        else if (entry.isFile() && entry.name.endsWith('.png')) out.push(full);
    }
    return out;
}

/** Verify an encoded file is AVIF and exactly 1920x1080 via `ffmpeg -i`. */
async function verifyAvif(file: string): Promise<void> {
    const probe = await new Promise<string>((resolve, reject) => {
        const proc = spawn(ffmpegPath(), [
            '-hide_banner', '-loglevel', 'info', '-nostats',
            '-i', file, '-f', 'null', '-',
        ], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
        let stderr = '';
        proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        proc.on('error', reject);
        proc.on('close', () => resolve(stderr)); // `ffmpeg -i` output exists regardless of exit code
    });
    const videoLine = probe.split(/\r?\n/).find((l) => l.includes('Stream #0:0'));
    if (!videoLine) throw new Error(`No video stream found in ${file}`);
    if (!videoLine.includes('av1')) throw new Error(`Not AV1/AVIF encoded: ${file}\n${videoLine}`);
    if (!videoLine.includes(`${TARGET_WIDTH}x${TARGET_HEIGHT}`)) {
        throw new Error(`Wrong dimensions (expected ${TARGET_WIDTH}x${TARGET_HEIGHT}): ${file}\n${videoLine}`);
    }
}

async function encodeAllToStaging(): Promise<number> {
    const pngs = walkPngs(SCREENSHOTS_TEMP_DIR);
    if (pngs.length === 0) {
        throw new Error('No temporary screenshots found — did the screenshot tests run?');
    }
    console.log(`[teardown] encoding ${pngs.length} screenshots to AVIF…`);
    rmSync(STAGING_DIR, {recursive: true, force: true});

    for (const png of pngs) {
        const rel = path.relative(SCREENSHOTS_TEMP_DIR, png); // <nested>/<name>.png
        const {width, height} = pngSize(png);
        // Strict: stretching a wrong-sized capture (e.g. DevTools-docked
        // window) produces distorted screenshots — fail instead.
        if (width !== TARGET_WIDTH || height !== TARGET_HEIGHT) {
            throw new Error(
                `Wrong capture size ${width}x${height} (expected ${TARGET_WIDTH}x${TARGET_HEIGHT}): ${rel}`,
            );
        }
        const outDir = path.join(STAGING_DIR, path.dirname(rel));
        mkdirSync(outDir, {recursive: true});
        const avif = path.join(STAGING_DIR, rel.replace(/\.png$/, '.avif'));

        const args = ['-y', '-i', png, '-frames:v', '1',
            '-c:v', 'libsvtav1', '-crf', '30', '-preset', '6', '-svtav1-params', 'avif=1', avif];
        await runFfmpeg(args);
        await verifyAvif(avif);
    }
    return pngs.length;
}

/** Replace media/screenshots wholesale with the freshly encoded staging dir. */
function swapScreenshotsIntoPlace(): void {
    rmSync(SCREENSHOTS_DIR, {recursive: true, force: true});
    renameSync(STAGING_DIR, SCREENSHOTS_DIR);
}

export default async function globalTeardown(): Promise<void> {
    // The fixtures' afterEach writes this marker on any failure. (.last-run.json
    // cannot be used: Playwright's LastRunReporter.onEnd fires after teardown.)
    if (existsSync(RUN_FAILED_MARKER)) {
        console.warn('[teardown] Tests did not pass — keeping screenshots-temporary and appdata.');
        return;
    }

    try {
        const count = await encodeAllToStaging();
        swapScreenshotsIntoPlace();
        console.log(`[teardown] ${count} AVIF screenshots written to ${SCREENSHOTS_DIR}`);

        rmSync(SCREENSHOTS_TEMP_DIR, {recursive: true, force: true});
        rmSync(APPDATA_DIR, {recursive: true, force: true});
        rmSync(RUN_FAILED_MARKER, {force: true});
        console.log('[teardown] cleaned screenshots-temporary and tests/integration/appdata.');
    } catch (error) {
        console.error('[teardown] failed — temp artifacts kept for inspection.', error);
        throw error;
    }
}