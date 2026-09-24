import { spawn } from 'child_process';
import { resolveTool } from './resolve-tool.js';

/** A parsed chapter entry. */
export interface ParsedChapter {
    /** Timestamp as "_HH_MM_SS_MMM" (compatible with existing _Chapters format). */
    timestamp: string;
    /** Chapter title string. */
    title: string;
    /** BCP-47 language tag if present and not "und". */
    language?: string;
}

/**
 * Run `mkvinfo INPUT` and parse the text output for chapter entries.
 *
 * Only call this when `identifyFile()` returned chapters (i.e.
 * `result.chapters.length > 0`), since mkvinfo is slower than identify.
 *
 * mkvinfo text format uses indentation with `|+ ` for direct children and
 * `| +` for continuation lines. We parse chapter atoms containing:
 *   - "Chapter time start: HH:MM:SS.mmm..."
 *   - "Chapter string: ..." (title)
 *   - "Chapter language (IETF BCP 47): ..." and "Chapter language: ..."
 *
 * Returns an array of parsed chapters, or an empty array on failure.
 *
 * @param filePath - Path to the Matroska file
 * @returns Parsed chapter entries
 */
export async function parseChaptersFromMkvinfo(filePath: string): Promise<ParsedChapter[]> {
    return new Promise((resolve) => {
        const proc = spawn(resolveTool('mkvinfo'), [filePath]);

        let stdout = '';

        proc.stdout.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        proc.on('error', () => {
            resolve([]);
        });

        proc.on('close', (code) => {
            // Non-zero exit is fine — we just return what we can parse
            if (code !== null && code > 1 && stdout.length === 0) {
                resolve([]);
                return;
            }

            const chapters = parseMkvinfoOutput(stdout);
            resolve(chapters);
        });
    });
}

/**
 * Parse mkvinfo text output and extract chapter atoms with timestamps,
 * titles, and languages. Handles "und" (undefined) by treating it as absent.
 */
function parseMkvinfoOutput(output: string): ParsedChapter[] {
    const lines = output.split(/\r?\n/);
    const chapters: ParsedChapter[] = [];

    // Track chapter atom state: we parse indentation-based hierarchy
    let chapterTimeStart: string | undefined;
    let chapterString: string | undefined;
    let chapterLang: string | undefined;
    let inChapterAtom = false;
    let atomIndent = -1;

    for (const rawLine of lines) {
        if (!rawLine.trim()) continue;
        const trimmed = rawLine.replace(/\s+$/, '');

        // Detect indentation depth — spaces between '|' and the '+'/'-' marker
        const indent = countPipeDepth(trimmed);

        // When we encounter a Chapter atom line, flush any prior atom first,
        // then (if we're not already inside one) begin tracking a new atom.
        const isChapterAtom = trimmed.includes('Chapter atom');
        if (isChapterAtom) {
            if (inChapterAtom) {
                // We're already inside an atom — this is a sibling atom.
                // Flush the current one before setting up the new one.
                flushChapter();
            }
            inChapterAtom = true;
            atomIndent = indent;
            chapterTimeStart = undefined;
            chapterString = undefined;
            chapterLang = undefined;
            continue;
        }

        if (!inChapterAtom) continue;

        // If indent drops below the atom's indent, we've left the atom scope
        if (indent < atomIndent) {
            flushChapter();
            inChapterAtom = false;
            continue;
        }

        // Parse fields within a chapter atom
        if (trimmed.includes('Chapter time start:')) {
            chapterTimeStart = extractValue(trimmed, 'Chapter time start:');
        } else if (trimmed.includes('Chapter string:')) {
            chapterString = extractValue(trimmed, 'Chapter string:');
        } else if (trimmed.includes('Chapter language (IETF BCP 47):')) {
            const val = extractValue(trimmed, 'Chapter language (IETF BCP 47):');
            chapterLang = isUnd(val) ? undefined : (val ?? chapterLang);
        } else if (trimmed.includes('Chapter language:')) {
            const val = extractValue(trimmed, 'Chapter language:');
            if (!chapterLang) {
                chapterLang = isUnd(val) ? undefined : val;
            }
        }
    }

    flushChapter();

    return chapters;

    function flushChapter(): void {
        if (chapterTimeStart && chapterString) {
            chapters.push({
                timestamp: timestampToUnderscore(chapterTimeStart),
                title: chapterString,
                language: chapterLang,
            });
        }
        chapterTimeStart = undefined;
        chapterString = undefined;
        chapterLang = undefined;
    }
}

/**
 * Measure mkvinfo's indentation depth from the spacing between `|` and `+`/`-`.
 *
 * mkvinfo text format uses one `|` per line, with depth conveyed by the number
 * of spaces after it before the `+` or `-` branch marker.
 *
 *   "|+ ..."       → depth 0 (0 spaces between | and +)
 *   "| + ..."       → depth 1 (1 space)
 *   "|  + ..."      → depth 2 (2 spaces)
 *   "|   + ..."     → depth 3 (3 spaces)
 *   "|    + ..."    → depth 4 (4 spaces)
 *
 * Lines without a leading `|` (e.g. the very first "+ EBML head") are depth 0.
 */
function countPipeDepth(line: string): number {
    const pipeIdx = line.indexOf('|');
    if (pipeIdx < 0) return 0;
    const branchIdx = line.indexOf('+', pipeIdx);
    if (branchIdx < 0) return line.indexOf('-', pipeIdx);
    if (branchIdx < 0) return 0;
    // Depth = spaces between '|' and the '+'/'-' marker
    return Math.max(0, branchIdx - pipeIdx - 1);
}

/**
 * Extract the value after a colon+space following a label.
 * e.g. "Chapter string: Prologue" → "Prologue"
 */
function extractValue(line: string, label: string): string | undefined {
    const idx = line.indexOf(label);
    if (idx < 0) return undefined;
    const val = line.slice(idx + label.length).trim();
    return val || undefined;
}

/**
 * Check if a language value is "und" (undefined) — treat as absent.
 */
function isUnd(val: string | undefined): val is 'und' | undefined {
    return val === undefined || val === 'und';
}

/**
 * Convert a "HH:MM:SS.mmm..." timestamp to the underscore format used
 * in _Chapters: "_HH_MM_SS_MMM".
 */
function timestampToUnderscore(ts: string): string {
    const parts = ts.split(':');
    if (parts.length !== 3) {
        // Fallback: replace : with _
        return `_${ts.replace(/:/g, '_')}`;
    }
    const secParts = parts[2].split('.');
    const h = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const s = secParts[0].padStart(2, '0');
    const ms = (secParts[1] ?? '000').padEnd(3, '0').slice(0, 3);
    return `_${h}_${m}_${s}_${ms}`;
}
