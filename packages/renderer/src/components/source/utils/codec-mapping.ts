/**
 * Codec name ↔ ID mapping using node-av constants via the preload bridge.
 * NO top-level side effects — maps are initialized lazily on first use.
 */
import { getCodecConstants, type CodecConstants } from '@app/preload';
import { getCodecLabel } from '@/lib/stream-match';
import type { VisualRow } from '@/components/source/types/stream-match-types';

let _codecConstants: CodecConstants | null = null;
let _mapsInitialized = false;
const codecNameToId: Record<string, number> = {};
const codecIdToName: Record<number, string> = {};
let _codecInitPromise: Promise<void> | null = null;

async function ensureCodecMaps(): Promise<void> {
    if (_mapsInitialized) return;
    if (_codecInitPromise) return _codecInitPromise;
    _codecInitPromise = (async () => {
        _codecConstants = await getCodecConstants();
        _mapsInitialized = true;

        const c = _codecConstants;
        // Core canonical names (short, no punctuation)
        const entries: [string, number][] = [
            // Video
            ['AV1', c.AV1], ['AVC', c.AVC], ['HEVC', c.HEVC],
            ['MPEG2', c.MPEG2], ['MPEG4', c.MPEG4], ['MPEG2TS', c.MPEG2TS],
            ['FFV1', c.FFV1], ['VP9', c.VP9], ['VP8', c.VP8], ['VC1', c.VC1],
            // Audio
            ['OPUS', c.OPUS], ['VORBIS', c.VORBIS], ['AAC', c.AAC],
            ['AC3', c.AC3], ['EAC3', c.EAC3], ['FLAC', c.FLAC],
            ['PCM', c.PCM], ['WAVPACK', c.WAVPACK], ['DTS', c.DTS],
            ['TRUEHD', c.TRUEHD], ['MP3', c.MP3],
            // Subtitle
            ['SRT', c.SRT], ['PGS', c.PGS], ['SSA', c.SSA],
            ['ASS', c.ASS], ['SUBRIP', c.SUBRIP], ['DVD', c.DVD],
            ['MOV', c.MOV], ['WEBVTT', c.WEBVTT],
            // Aliases for common alternative names / display labels
            // Video aliases
            ['H264', c.AVC], ['H.264', c.AVC], ['X264', c.AVC],
            ['H265', c.HEVC], ['H.265', c.HEVC], ['X265', c.HEVC],
            ['MPEG2VIDEO', c.MPEG2],
            // Audio aliases
            ['WAV', c.PCM],  // PCM in WAV container
            ['LPCM', c.PCM],
            ['DOLBY DIGITAL', c.AC3],
            ['DOLBY DIGITAL+', c.EAC3],
            // Subtitle aliases
            ['HDMV PGS', c.PGS],
            ['MOV_TEXT', c.MOV],
            ['MOVTEXT', c.MOV],
        ];
        for (const [name, id] of entries) {
            codecNameToId[name] = id;
            codecIdToName[id] = name;
        }
    })();
}

/**
 * Resolve a codec name string to its numeric NodeAV AVCodecID constant.
 * Uses both exact match and fuzzy (prefix/suffix) matching.
 * Returns undefined only for completely unknown codec names.
 */
// Eagerly kick off codec map initialization (no await — maps load in background)
ensureCodecMaps();

export function resolveCodecId(value: string): number | undefined {
    if (!value) return undefined;
    if (!_mapsInitialized) return undefined;
    const upper = value.toUpperCase().trim();
    // 1. Exact match
    if (upper in codecNameToId) return codecNameToId[upper];
    // 2. Parse as number (e.g. "27" from numeric input)
    const asNumber = Number(upper);
    if (!Number.isNaN(asNumber)) return asNumber;
    // 3. Fuzzy match: remove separators, try prefix/suffix on canonical names
    const cleaned = value.replace(/[-/–—.: ]/g, '').toUpperCase();
    for (const [name, id] of Object.entries(codecNameToId)) {
        if (cleaned.endsWith(name) || cleaned.startsWith(name)) return id;
    }
    // 4. Try splitting on common separators and matching each token
    const tokens = upper.split(/[/\-–—.: ]+/);
    for (const token of tokens) {
        if (token in codecNameToId) return codecNameToId[token];
    }
    return undefined;
}

export function formatValue(row: VisualRow, rawVal: unknown): string {
    if (row.field === 'codec' && typeof rawVal === 'number') {
        return getCodecLabel(rawVal);
    }
    ensureCodecMaps();
    return String(rawVal ?? '');
}
