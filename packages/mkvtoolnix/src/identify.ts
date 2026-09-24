import { spawn } from 'child_process';
import type { MkvmergeIdentificationOutput } from './types.js';
import { resolveTool } from './resolve-tool.js';

/**
 * Identify a media file using `mkvmerge -J`.
 *
 * Spawns mkvmerge with `-J file-name` (alias for
 * `--identification-format json --identify file-name`), consumes stdout,
 * and returns the parsed JSON output.
 *
 * Returns `null` if mkvmerge is not available, returns a non-zero exit code,
 * or if the JSON output cannot be parsed.
 *
 * @param filePath - Path to the media file to identify
 * @returns Parsed identification output, or null on failure
 */
export async function identifyFile(filePath: string): Promise<MkvmergeIdentificationOutput | null> {
    return new Promise((resolve) => {
        const mkvmerge = spawn(resolveTool('mkvmerge'), ['-J', filePath]);

        let stdout = '';

        mkvmerge.stdout.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        mkvmerge.on('close', (code) => {
            // mkvmerge return codes: 0 = success, 1 = success with warnings, 2 = error
            if (code !== null && code > 1) {
                resolve(null);
                return;
            }

            try {
                const parsed = JSON.parse(stdout) as MkvmergeIdentificationOutput;
                resolve(parsed);
            } catch {
                resolve(null);
            }
        });

        mkvmerge.on('error', () => {
            // mkvmerge binary not found, not executable, etc.
            resolve(null);
        });
    });
}
