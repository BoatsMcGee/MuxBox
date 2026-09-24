import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { resolveTool } from './resolve-tool.js';

/**
 * Build the mkvmerge argument list for adding chapters from one or more
 * source files to an already-muxed output file.
 *
 * Command structure:
 * mkvmerge -o output.mkv file1.mkv [--chapter-sync <ms>] --no-subtitles --no-video --no-audio --no-attachments --no-track-tags file2.mkv
 * - file1.mkv: the muxed file with all tracks we want
 * - file2.mkv: the chapters source (only chapters are used, everything else excluded)
 *
 * `--chapter-sync` is a per-input-file option: it applies to the *following*
 * input file. It must therefore be emitted BEFORE the chapters source path,
 * otherwise mkvmerge silently ignores it.
 */
export function buildMkvmergeChaptersArgs(
    outputFilePath: string,
    chaptersSources?: { path: string; delay?: number; }[],
): string[] {
    // Build the temp output path with .temp.mkv suffix
    const parsedPath = path.parse(outputFilePath);
    const tempOutputPath = path.join(parsedPath.dir, `${parsedPath.name}.temp.mkv`);

    // Build mkvmerge arguments
    const args: string[] = ['-o', tempOutputPath];

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
 * Runs mkvmerge on the output file, supporting multiple chapters sources.
 * Outputs to {DIR}/{NAME}.temp.mkv, then renames to final path on success.
 */
export async function mkvmergeChapters(
    outputFilePath: string,
    chaptersSources?: { path: string; delay?: number; }[],
): Promise<void> {
    const args = buildMkvmergeChaptersArgs(outputFilePath, chaptersSources);

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
