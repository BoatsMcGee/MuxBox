import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { resolveTool } from './resolve-tool.js';
import { getCompressibleSubtitleTrackIds } from './compression.js';
import { identifyFile } from './identify.js';

/**
 * Build the mkvmerge argument list for adding chapters from one or more
 * source files to an already-muxed output file.
 *
 * Command structure:
 * mkvmerge -o output.mkv [--compression TID:zlib]... file1.mkv [--chapter-sync <ms>] --no-subtitles --no-video --no-audio --no-attachments --no-track-tags file2.mkv
 * - file1.mkv: the muxed file with all tracks we want
 * - file2.mkv: the chapters source (only chapters are used, everything else excluded)
 *
 * `--chapter-sync` and `--compression` are per-input-file/per-track options: they
 * apply to the *following* input file. They must therefore be emitted BEFORE that
 * input file's path, otherwise mkvmerge silently ignores them.
 *
 * @param compressTrackIds - Source track IDs to zlib-compress. Only text-based
 *   subtitle tracks should be passed (see `getCompressibleSubtitleTrackIds`);
 *   bitmap subtitle codecs do not support Matroska ContentEncodings.
 */
export function buildMkvmergeChaptersArgs(
    outputFilePath: string,
    chaptersSources?: { path: string; delay?: number; }[],
    compressTrackIds?: readonly number[],
): string[] {
    // Build the temp output path with .temp.mkv suffix
    const parsedPath = path.parse(outputFilePath);
    const tempOutputPath = path.join(parsedPath.dir, `${parsedPath.name}.temp.mkv`);

    // Build mkvmerge arguments
    const args: string[] = ['-o', tempOutputPath];

    // Force zlib compression on the requested subtitle tracks. These must come
    // before the muxed file path — see the option-order note above.
    for (const trackId of compressTrackIds ?? []) {
        args.push('--compression', `${trackId}:zlib`);
    }

    // Add the muxed output file as the primary input (contains all tracks we want)
    args.push(outputFilePath);

    // If chapters source is defined, add it with flags to exclude everything except chapters
    chaptersSources?.forEach(({ path: chaptersPath, delay }) => {
        // Apply chapter delay if specified (value is in milliseconds).
        // Use --chapter-sync with special track ID -2 for chapters. This must
        // come BEFORE the source path so it applies to that input file.
        if (delay !== undefined && delay !== 0) {
            const offsetMs = Math.round(delay);
            args.push('--chapter-sync', `${offsetMs}`);
        }

        // Exclude all track types and tags from the source file
        args.push(
            '--no-subtitles',
            '--no-video',
            '--no-audio',
            '--no-attachments',
            '--no-track-tags',
            chaptersPath,
        );
    });

    return args;
}

/**
 * Probe the just-muxed file and resolve which subtitle tracks should be zlib-compressed.
 *
 * `subtitleTrackIds` holds 0-based output track indices chosen by the muxer, which
 * correspond exactly to mkvmerge's 0-based track `id` in the muxed file (verified: mkvmerge
 * numbers tracks 0..N-1 in file order). The probe re-reads the file so that bitmap
 * subtitle codecs — which cannot carry a Matroska `ContentEncodings` — are filtered out
 * here rather than at every call site.
 *
 * Best-effort by design: any failure yields an empty list, so compression is skipped
 * rather than the mux failing. The file was just written, so it is already in the page
 * cache and the extra `mkvmerge -J` pass is cheap.
 */
async function resolveCompressibleTrackIds(
    outputFilePath: string,
    subtitleTrackIds: readonly number[] | undefined,
): Promise<number[]> {
    if (!subtitleTrackIds || subtitleTrackIds.length === 0) return [];

    try {
        const identified = await identifyFile(outputFilePath);
        if (!identified) return [];
        return getCompressibleSubtitleTrackIds(identified.tracks, new Set(subtitleTrackIds));
    } catch {
        return [];
    }
}

/**
 * Runs mkvmerge on the output file, supporting multiple chapters sources.
 * Outputs to {DIR}/{NAME}.temp.mkv, then renames to final path on success.
 *
 * Also zlib-compresses text-based subtitle tracks. node-av (FFmpeg) cannot do this —
 * FFmpeg's Matroska muxer never writes the EBML `ContentEncodings` element — so this
 * mkvmerge pass is the only place it can happen. It costs no extra pass because the
 * file is already rewritten here.
 *
 * @param subtitleTrackIds - Output track indices (0-based, in muxed order) of the
 *   subtitle tracks that should be compressed. The user-facing `compress` setting is
 *   resolved by the caller; bitmap subtitle codecs are filtered out here.
 */
export async function mkvmergeChapters(
    outputFilePath: string,
    chaptersSources?: { path: string; delay?: number; }[],
    subtitleTrackIds?: readonly number[],
): Promise<void> {
    const args = buildMkvmergeChaptersArgs(
        outputFilePath,
        chaptersSources,
        await resolveCompressibleTrackIds(outputFilePath, subtitleTrackIds),
    );

    // Build the temp output path with .temp.mkv suffix (used for rename/cleanup)
    const parsedPath = path.parse(outputFilePath);
    const tempOutputPath = path.join(parsedPath.dir, `${parsedPath.name}.temp.mkv`);

    return new Promise((resolve, reject) => {
        const mkvmerge = spawn(resolveTool('mkvmerge'), args);

        let stderr = '';

        mkvmerge.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        mkvmerge.on('close', (code) => {
            // mkvmerge return codes: 0 = success, 1 = success with warnings, 2 = error
            if (code === 0 || code === 1) {
                try {
                    // Attempt direct rename first
                    fs.renameSync(tempOutputPath, outputFilePath);
                    resolve();
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                } catch (err) {
                    // Fallback for Windows where rename may fail if target exists or is locked
                    try {
                        fs.copyFileSync(tempOutputPath, outputFilePath);
                        fs.unlinkSync(tempOutputPath);
                        resolve();
                    } catch (fallbackErr) {
                        reject(new Error(`Failed to replace output file: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`));
                    }
                }
            } else {
                // Clean up temp file on failure
                if (fs.existsSync(tempOutputPath)) {
                    fs.unlinkSync(tempOutputPath);
                }
                reject(new Error(`mkvmerge failed with exit code ${code}: ${stderr}`));
            }
        });

        mkvmerge.on('error', (err) => {
            reject(new Error(`Failed to spawn mkvmerge: ${err.message}`));
        });
    });
}
