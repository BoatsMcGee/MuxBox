/**
 * Client-side stream matching using numeric AVCodecID/AVDisposition values.
 * Mirrors the backend matchSelector logic for live preview.
 *
 * Stream data comes from node-av via the preload's demuxStreams() function,
 * providing numeric types that match the backend exactly.
 */

import type { StreamInfo, TrackComparison, CodecEntry } from '@app/preload';
import { getCodecEntryList } from '@app/preload';
import { tryParseRegex } from './utils.js';
import {
    TEMPLATE_FIELDS,
    resolveField,
    type FieldConfig,
} from './template-fields.js';

/**
 * Normalize a language code from MediaInfo track data.
 * MediaInfo provides language in various formats (ISO 639-1, ISO 639-2, BCP-47).
 * We try to extract a sensible short code.
 */
export function normalizeLanguage(track: Record<string, unknown>): string | null {
    // Prefer ISO 639-2/T three-letter code, then ISO 639-1 two-letter, then raw
    const lang3 = track['Language_String3'] as string | undefined;
    if (lang3 && lang3 !== 'und') return lang3.toLowerCase();

    const lang = track['Language'] as string | undefined;
    if (lang && lang !== 'und') return lang.toLowerCase();

    const lang2 = track['Language_String2'] as string | undefined;
    if (lang2 && lang2 !== 'und') return lang2.toLowerCase();

    return null;
}

/**
 * Auto-generated codec entries with computed display names.
 * Sources ALL AV_CODEC_ID_* constants from NodeAV via the preload bridge,
 * resolving friendly names through `getCodecName()` from @app/muxer.
 *
 * Display format: "friendlyName (VARIABLE_NAME)" or "numericId (VARIABLE_NAME)".
 */
export { type CodecEntry } from '@app/preload';

// Lazy-init cache for codec entries with display names
let _codecDisplayEntries: (CodecEntry & { displayName: string })[] | null = null;
let _codecInitPromise: Promise<void> | null = null;

async function ensureCodecEntries(): Promise<void> {
    if (_codecDisplayEntries) return;
    if (_codecInitPromise) return _codecInitPromise;
    _codecInitPromise = (async () => {
        const raw = await getCodecEntryList();
        _codecDisplayEntries = raw.map(e => ({
            ...e,
            displayName: e.friendlyName
                ? `${e.friendlyName} (${e.varName})`
                : `${e.id} (${e.varName})`,
        }));
    })();
    return _codecInitPromise;
}

/** A searchable codec suggestion with a numeric value and a display label. */
export interface CodecSuggestion {
    /** Numeric AVCodecID as string (e.g. "225" for AV1). */
    value: string;
    /** Human-readable label (e.g. "AV1 (AV_CODEC_ID_AV1)"). */
    label: string;
}

/**
 * Returns codec suggestions for the searchable Combobox input.
 * Each suggestion carries the numeric AVCodecID as `value` and a
 * human-readable label (e.g. "AV1 (AV_CODEC_ID_AV1)") for display.
 * Kicks off background loading if not yet initialized.
 */
export function getCodecSuggestions(): CodecSuggestion[] {
    ensureCodecEntries();
    return (_codecDisplayEntries ?? []).map(e => ({
        value: String(e.id),
        label: e.displayName,
    }));
}

/** Get the display label for an AVCodecID numeric value. */
export function getCodecLabel(codecId: number): string {
    ensureCodecEntries();
    const entry = (_codecDisplayEntries ?? []).find(e => e.id === codecId);
    return entry?.displayName ?? `${codecId} (AV_CODEC_ID_UNKNOWN)`;
}

/**
 * Resolve a user-input string to a numeric AVCodecID.
 * Tries: direct number parse → exact label match → fuzzy name match.
 * Returns `undefined` for completely unresolvable input.
 */
export function resolveCodecValue(text: string): number | undefined {
    if (!text) return undefined;
    ensureCodecEntries();

    // 1. Try direct number parse (e.g. "225")
    const asNumber = Number(text);
    if (!Number.isNaN(asNumber)) {
        // Verify it's a known codec ID
        const entry = (_codecDisplayEntries ?? []).find(e => e.id === asNumber);
        if (entry) return asNumber;
    }

    // 2. Try exact match against display labels
    const normalized = text.toUpperCase().trim();
    const match = (_codecDisplayEntries ?? []).find(e =>
        e.displayName.toUpperCase().trim() === normalized,
    );
    if (match) return match.id;

    // 3. Fuzzy: strip separators from label and try
    const cleaned = text.replace(/[-/–—.: ()]/g, '').toUpperCase();
    const fuzzy = (_codecDisplayEntries ?? []).find(e => {
        const entryCleaned = e.displayName.replace(/[-/–—.: ()]/g, '').toUpperCase();
        return entryCleaned === cleaned || entryCleaned.endsWith(cleaned) || entryCleaned.startsWith(cleaned);
    });
    return fuzzy?.id;
}

// ─── Disposition label map (AV_DISPOSITION_* flag → label) ──
// These are FFmpeg constants, stable and not subject to change.
export const DISPOSITION_LABEL_MAP: Record<string, string> = {
    '1': 'Default',
    '2': 'Dub',
    '4': 'Original',
    '8': 'Comment',
    '16': 'Lyrics',
    '32': 'Karaoke',
    '64': 'Forced',
    '128': 'Hearing Impaired',
    '256': 'Visual Impaired',
    '512': 'Clean Effects',
    '1024': 'Attached Picture',
    '2048': 'Timed Thumbnails',
    '4096': 'Non-Diegetic',
    '65536': 'Captions',
    '131072': 'Descriptions',
    '262144': 'Metadata',
    '524288': 'Dependent',
    '1048576': 'Still Image',
    '2097152': 'Multilayer',
};

/** Get a comma-separated list of disposition labels from an array of flag values. */
export function getDispositionLabels(flags: number[]): string {
    if (flags.length === 0) return '—';
    return flags.map(f => DISPOSITION_LABEL_MAP[String(f)] ?? `Flag ${f}`).join(', ');
}

/**
 * Get a human-readable stream type label from AVMEDIA_TYPE value.
 */
export function getStreamTypeLabel(codecType: number): string {
    switch (codecType) {
        case 0: return 'Video';
        case 1: return 'Audio';
        case 3: return 'Subtitle';
        case 4: return 'Attachment';
        default: return `Type ${codecType}`;
    }
}

/**
 * Normalizes boolean values for comparison, handling string 'true'/'false' from UI selectors.
 */
function normalizeForComparison(val: unknown): unknown {
    if (typeof val === 'string') {
        if (val === 'true') return true;
        if (val === 'false') return false;
    }
    return val;
}

/**
 * WeakMap-based memoization cache for matchSelectorValue.
 * Selector objects are used as WeakMap keys, with an inner Map<string, boolean>
 * keyed by JSON.stringify(value). This avoids re-computing pure match results
 * for identical selector/value pairs during reactivity cascades.
 * The cache is automatically garbage-collected when selector objects are no
 * longer referenced.
 */
const matchSelectorCache = new WeakMap<object, Map<string, boolean>>();

export function matchSelectorValue(selector: unknown, value: unknown): boolean {
    if (selector == null || selector === undefined) return true;

    // Check cache for object selectors (the common case in stream matching)
    if (typeof selector === 'object' && selector !== null) {
        let innerCache = matchSelectorCache.get(selector);
        if (innerCache) {
            const cacheKey = JSON.stringify(value);
            const cached = innerCache.get(cacheKey);
            if (cached !== undefined) return cached;
        }

        const result = computeMatchSelectorValue(selector, value);

        // Cache the result
        if (!innerCache) {
            innerCache = new Map();
            matchSelectorCache.set(selector, innerCache);
        }
        innerCache.set(JSON.stringify(value), result);

        return result;
    }

    return normalizeForComparison(value) === normalizeForComparison(selector);
}

/**
 * Un-memoized match logic extracted from matchSelectorValue for cacheable computation.
 */
function computeMatchSelectorValue(selector: unknown, value: unknown): boolean {
    const sel = selector as Record<string, unknown>;
    if ('equal' in sel) return normalizeForComparison(value) === normalizeForComparison(sel.equal);
    if ('not' in sel) return !matchSelectorValue(sel.not, value);
    if ('allOf' in sel && Array.isArray(sel.allOf)) return sel.allOf.every((s) => matchSelectorValue(s, value));
    if ('anyOf' in sel && Array.isArray(sel.anyOf)) return sel.anyOf.some((s) => matchSelectorValue(s, value));
    if ('oneOf' in sel && Array.isArray(sel.oneOf)) return sel.oneOf.filter((s) => matchSelectorValue(s, value)).length === 1;
    if ('greaterThan' in sel && typeof value === 'number') return value > (sel.greaterThan as number);
    if ('lessThan' in sel && typeof value === 'number') return value < (sel.lessThan as number);
    if ('pattern' in sel) {
        const patternVal = sel.pattern;
        const flags = 'patternFlags' in sel ? String(sel.patternFlags) : '';
        const regex = patternVal instanceof RegExp ? patternVal : tryParseRegex(String(patternVal), flags);
        if (!regex) return false;
        return regex.test(String(value));
    }
    if ('contains' in sel) return String(value).includes(String(sel.contains as string));
    if ('startsWith' in sel) return String(value).startsWith(String(sel.startsWith as string));
    if ('endsWith' in sel) return String(value).endsWith(String(sel.endsWith as string));
    return false;
}

export type StreamType = 'video' | 'audio' | 'subtitle' | 'attachment';

/** Map node-av AVMEDIA_TYPE_* codes to our StreamType. */
function codecTypeToStreamType(codecType: number): StreamType | null {
    // The values from node-av constants
    switch (codecType) {
        case 0: return 'video';    // AVMEDIA_TYPE_VIDEO
        case 1: return 'audio';    // AVMEDIA_TYPE_AUDIO
        case 3: return 'subtitle'; // AVMEDIA_TYPE_SUBTITLE
        case 4: return 'attachment'; // AVMEDIA_TYPE_ATTACHMENT
        default: return null;
    }
}

export interface MatchedTrack {
    index: number;
    type: StreamType;
    codec: string;
    language: string;
    title: string;
    matched: boolean;
    /** The raw StreamInfo for detailed access */
    streamInfo: StreamInfo;
    /** The matching item's modify config, if any */
    modify?: Record<string, unknown>;
    /** The matching item's preprocess config, if any */
    preprocess?: Record<string, unknown>;
}

/**
 * Match a file's StreamInfo array against a set of stream items.
 * Returns all tracks with a `matched` flag.
 */
export function matchStreamInfoTracks(
    streamInfos: StreamInfo[] | null,
    streamType: StreamType,
    items: { match: Record<string, unknown>; modify?: Record<string, unknown>; preprocess?: Record<string, unknown> }[],
): MatchedTrack[] {
    if (!streamInfos) return [];

    const result: MatchedTrack[] = [];

    for (const info of streamInfos) {
        const type = codecTypeToStreamType(info.codecType);
        if (type === null || type !== streamType) continue;

        let matchedItem: { match: Record<string, unknown>; modify?: Record<string, unknown>; preprocess?: Record<string, unknown> } | undefined;
        let matched = false;

        if (items.length === 0) {
            matched = true;
        } else {
            for (const item of items) {
                if (matchEntry(item, info)) {
                    matched = true;
                    matchedItem = item;
                    break;
                }
            }
        }

        result.push({
            index: info.index,
            type,
            codec: info.codecName,
            language: info.metadata['language'] ?? '—',
            title: info.metadata['title'] ?? '',
            matched,
            streamInfo: info,
            modify: matchedItem?.modify,
            preprocess: matchedItem?.preprocess,
        });
    }

    return result;
}

/**
 * Extract a property from a StreamInfo for matching.
 * Properties now use numeric AVCodecID/AVDisposition values,
 * matching the backend exactly.
 */
function getStreamInfoProperty(info: StreamInfo, prop: string): unknown {
    switch (prop) {
        case 'index': return info.index;
        case 'codec': return info.codecId; // numeric AVCodecID
        case 'title': return info.metadata['title'] ?? undefined;
        case 'language': return info.metadata['language'] ?? undefined;
        case 'disposition': {
            // For disposition matching, we return true if ALL specified dispositions are present.
            // The selector schema is { "64": {equal: true} } or similar.
            // But disposition matching is done differently: the selector is
            // a Record<AVDisposition, Selector<boolean>> — each entry checks
            // if the stream has that disposition flag.
            // Our getStreamInfoProperty is called per entry, so the "value" here
            // is the disposition's presence (boolean), and the schema is the selector.
            // We return the dispositions array as a special case — actual matching
            // is handled in matchStreamInfoTracks disposition case.
            return info.dispositions;
        }
        case 'width': return info.width ?? undefined;
        case 'height': return info.height ?? undefined;
        case 'channels': return info.channels ?? undefined;
        case 'bitrate': return info.bitRate ?? undefined;
        case 'size': {
            if (info.bitRate != null && info.duration != null) {
                return info.bitRate * info.duration;
            }
            return undefined;
        }
        case 'duration': return info.duration ?? undefined;
        case 'fileName': return info.metadata['filename'] ?? info.metadata['Filename'] ?? undefined;
        case 'mimeType': return info.metadata['mimetype'] ?? info.metadata['MIMEType'] ?? undefined;
        default: return undefined;
    }
}

/**
 * Extended match function that handles disposition matching specially.
 * Disposition matching in the backend iterates over Object.entries(schema)
 * and calls stream.hasDisposition(Number(disp)). We do the same here.
 */
function matchEntry(
    item: { match: Record<string, unknown>; modify?: Record<string, unknown>; preprocess?: Record<string, unknown> },
    info: StreamInfo,
): boolean {
    const match = item.match;
    if (!match || Object.keys(match).length === 0) return true;

    return Object.entries(match).every(([prop, schema]) => {
        // Disposition is special: schema is Record<AVDisposition, Selector<boolean>>
        if (prop === 'disposition' && schema && typeof schema === 'object') {
            const dispSchema = schema as Record<string, unknown>;
            return Object.entries(dispSchema).every(([dispKey, dispSelector]) => {
                const flag = Number(dispKey);
                const hasFlag = info.dispositions.includes(flag);
                return matchSelectorValue(dispSelector, hasFlag);
            });
        }
        const value = getStreamInfoProperty(info, prop);
        return matchSelectorValue(schema, value);
    });
}

/** Group matched tracks by file */
export interface FileStreamMatch {
    file: string;
    tracks: MatchedTrack[];
    anyMatched: boolean;
}

export function matchAllFiles(
    files: string[],
    streamInfoMap: Record<string, StreamInfo[] | null>,
    streamType: StreamType,
    items: { match: Record<string, unknown>; modify?: Record<string, unknown>; preprocess?: Record<string, unknown> }[],
): FileStreamMatch[] {
    return files.map((file) => {
        const tracks = matchStreamInfoTracks(streamInfoMap[file] ?? null, streamType, items);
        return {
            file,
            tracks,
            anyMatched: tracks.length === 0 || tracks.some((t) => t.matched),
        };
    });
}

/**
 * Aggregated per-file result combining all stream types.
 */
export interface AggregatedFileMatch {
    file: string;
    totalStreams: number;
    matchedStreams: number;
    tracks: MatchedTrack[];
    anyMatched: boolean;
}

/**
 * Match a file's StreamInfo array against ALL stream type items (video, audio, subtitle, attachment).
 */
export function matchAllStreamTypes(
    streamInfos: StreamInfo[] | null,
    videoItems: { match: Record<string, unknown>; modify?: Record<string, unknown>; preprocess?: Record<string, unknown> }[],
    audioItems: { match: Record<string, unknown>; modify?: Record<string, unknown>; preprocess?: Record<string, unknown> }[],
    subtitleItems: { match: Record<string, unknown>; modify?: Record<string, unknown>; preprocess?: Record<string, unknown> }[],
    attachmentItems: { match: Record<string, unknown>; modify?: Record<string, unknown>; preprocess?: Record<string, unknown> }[],
): AggregatedFileMatch {
    const allTracks: MatchedTrack[] = [];

    const videoTracks = matchStreamInfoTracks(streamInfos, 'video', videoItems);
    const audioTracks = matchStreamInfoTracks(streamInfos, 'audio', audioItems);
    const subtitleTracks = matchStreamInfoTracks(streamInfos, 'subtitle', subtitleItems);
    const attachmentTracks = matchStreamInfoTracks(streamInfos, 'attachment', attachmentItems);

    allTracks.push(...videoTracks, ...audioTracks, ...subtitleTracks, ...attachmentTracks);
    allTracks.sort((a, b) => a.index - b.index);

    const matchedCount = allTracks.filter((t) => t.matched).length;

    return {
        file: '',
        totalStreams: allTracks.length,
        matchedStreams: matchedCount,
        tracks: allTracks,
        anyMatched: matchedCount > 0,
    };
}

// ─── Modify / Preprocess simulation ──────────────────────────────────

/** Describes a single field change from original to modified value. */
export interface ModificationDelta {
    field: string;
    label: string;
    before: string;
    after: string;
    changed: boolean;
}

/**
 * Compute the "after" state of a matched track given its `modify` and `preprocess` config.
 * Returns the original track plus an array of changes that would be applied.
 */
export function computeModifiedTrack(track: MatchedTrack): MatchedTrack & { modifications: ModificationDelta[] } {
    const modifications: ModificationDelta[] = [];
    const modify = track.modify;
    const preprocess = track.preprocess;

    if (!modify && !preprocess) {
        return { ...track, modifications: [] };
    }

    if (modify && typeof modify === 'object' && Object.keys(modify).length > 0) {
        // Title — allow empty string "" to clear the title
        if (typeof modify.title === 'string') {
            const before = track.title || '—';
            if (before !== modify.title) {
                modifications.push({
                    field: 'title',
                    label: 'Title',
                    before,
                    after: modify.title || '(empty)',
                    changed: true,
                });
            }
        }

        // Language — allow empty string "" to clear the language
        if (typeof modify.language === 'string') {
            const before = track.language || '—';
            if (before !== modify.language) {
                modifications.push({
                    field: 'language',
                    label: 'Language',
                    before,
                    after: modify.language || '(empty)',
                    changed: true,
                });
            }
        }

        // Disposition
        if (modify.disposition && typeof modify.disposition === 'object') {
            const disp = modify.disposition as Record<string, boolean>;
            for (const [key, val] of Object.entries(disp)) {
                const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
                modifications.push({
                    field: `disposition.${key}`,
                    label: `Disposition: ${label}`,
                    before: '—',
                    after: val ? '✓ Enabled' : '✕ Disabled',
                    changed: true,
                });
            }
        }

        // Tags
        if (modify.tags && typeof modify.tags === 'object') {
            const tags = modify.tags as Record<string, string>;
            const entries = Object.entries(tags).filter(([, v]) => v !== undefined && v !== null && v !== '');
            if (entries.length > 0) {
                modifications.push({
                    field: 'tags',
                    label: 'Tags',
                    before: '—',
                    after: entries.map(([k, v]) => `${k}=${v}`).join(', '),
                    changed: true,
                });
            }
        }

        // Delay (audio/subtitle only)
        if (modify.delay !== undefined && modify.delay !== null && modify.delay !== '') {
            const delay = Number(modify.delay);
            if (!Number.isNaN(delay) && delay !== 0) {
                modifications.push({
                    field: 'delay',
                    label: 'Delay',
                    before: '0 ms',
                    after: `${delay} ms`,
                    changed: true,
                });
            }
        }

    } // ← closing brace for `if (modify && ...)` at line 380

    // Preprocess (audio only - opusenc)
    if (preprocess && preprocess.opusenc && typeof preprocess.opusenc === 'object') {
        const opus = preprocess.opusenc as Record<string, unknown>;
        const parts: string[] = [];
        for (const [key, val] of Object.entries(opus)) {
            if (val !== undefined && val !== null && val !== false && val !== '') {
                parts.push(`${key}=${val}`);
            }
        }
        if (parts.length > 0) {
            modifications.push({
                field: 'preprocess',
                label: 'Preprocess',
                before: 'None',
                after: `opusenc: ${parts.join(', ')}`,
                changed: true,
            });
        }
    }

    return { ...track, modifications };
}

// ─── Template field resolvers (mirrors backend) ────────────────

/**
 * Resolve the video codec tag from StreamInfo.
 */
function resolveVideoCodecTag(streamInfos: StreamInfo[]): string {
    const video = streamInfos.find(s => s.codecType === 0);
    if (!video) return '';
    return video.codecName; // Already a friendly name like "AVC", "HEVC", "AV1"
}

/**
 * Resolve the audio codec tag from the first audio stream.
 */
function resolveAudioCodecTag(streamInfos: StreamInfo[]): string {
    const audio = streamInfos.filter(s => s.codecType === 1);
    if (!audio.length) return '';
    return audio[0].codecName;
}

/**
 * Resolve the video height tag (e.g. "1080p", "1080i").
 * Appends 'i' for interlaced content (fieldOrder >= 2) or 'p' for progressive.
 */
function resolveVideoHeightTag(streamInfos: StreamInfo[]): string {
    const video = streamInfos.find(s => s.codecType === 0);
    if (!video || !video.height) return '';
    const suffix = video.fieldOrder !== undefined && video.fieldOrder >= 2 ? 'i' : 'p';
    return `${video.height}${suffix}`;
}

/**
 * Resolve the dual audio tag from audio streams' languages.
 */
function resolveDualAudioTag(streamInfos: StreamInfo[]): string {
    const audio = streamInfos.filter(s => s.codecType === 1);
    if (!audio.length) return '';
    const languages = new Set(audio.map(s => s.metadata['language']).filter(Boolean));
    if (languages.size === 2) return 'Dual Audio';
    if (languages.size > 2) return 'Multi Audio';
    return '';
}

import sanitize from 'sanitize-filename';

/**
 * Compute a preview of the output filename from a rename template and stream info.
 * Mirrors the backend {@link templateFileName} function from @app/muxer but works
 * with plain StreamInfo objects instead of node-av Stream objects. Uses the same
 * `sanitize-filename` package as multimux-core for identical sanitization behavior.
 *
 * Supports inline template fields: {{SERIES_NAME}}, {{SEASON_NUMBER}},
 * {{EPISODE_NUMBER}}, {{EPISODE_NAME}}, {{VIDEO_CODEC}},
 * {{AUDIO_CODEC}}, {{VIDEO_HEIGHT}}, {{DUAL_AUDIO}}.
 *
 * When `trackComparisons` (from a live EpisodeMuxer) is provided, stream-based
 * fields use the **muxed** (post-preprocess) codec — e.g. "OPUS" instead of "FLAC"
 * after opusenc. Otherwise falls back to raw StreamInfo[] (pre-preprocess).
 */
export function templateFileNameFromStreamInfo(
    template: string,
    series: {
        name: string;
        season: { number: number; name?: string };
        episode: { number: number; name?: string };
    },
    streamInfos: StreamInfo[],
    /** Optional live TrackComparison[] for post-preprocess codec resolution. */
    trackComparisons?: TrackComparison[],
    /** Per-field prefix/suffix configuration keyed by template tag. */
    fieldConfig?: Record<string, FieldConfig>,
): string {
    // Sanitize each field individually with no replacement (strips invalid chars),
    // exactly like multimux-core's templateFileName function does.
    let result = template;

    // Replace basic fields
    if (result.includes(TEMPLATE_FIELDS.SERIES_NAME)) {
        result = result.replace(TEMPLATE_FIELDS.SERIES_NAME, sanitize(series.name));
    }
    if (result.includes(TEMPLATE_FIELDS.SEASON_NUMBER)) {
        const pad = fieldConfig?.[TEMPLATE_FIELDS.SEASON_NUMBER]?.padding ?? 2;
        result = result.replace(TEMPLATE_FIELDS.SEASON_NUMBER, resolveField(TEMPLATE_FIELDS.SEASON_NUMBER, String(series.season.number).padStart(pad, '0'), fieldConfig));
    }
    if (result.includes(TEMPLATE_FIELDS.EPISODE_NUMBER)) {
        const pad = fieldConfig?.[TEMPLATE_FIELDS.EPISODE_NUMBER]?.padding ?? 2;
        result = result.replace(TEMPLATE_FIELDS.EPISODE_NUMBER, resolveField(TEMPLATE_FIELDS.EPISODE_NUMBER, String(series.episode.number).padStart(pad, '0'), fieldConfig));
    }
    if (result.includes(TEMPLATE_FIELDS.EPISODE_NAME) && series.episode.name) {
        result = result.replace(TEMPLATE_FIELDS.EPISODE_NAME, sanitize(series.episode.name));
    }

    // New inline stream-based fields
    if (result.includes(TEMPLATE_FIELDS.VIDEO_CODEC)) {
        // Use muxed codec from live TrackComparison if available
        if (trackComparisons) {
            const videoComp = trackComparisons.find(c => c.codecType === 'video');
            result = result.replace(TEMPLATE_FIELDS.VIDEO_CODEC, resolveField(TEMPLATE_FIELDS.VIDEO_CODEC, videoComp?.muxedCodec ?? resolveVideoCodecTag(streamInfos), fieldConfig));
        } else {
            result = result.replace(TEMPLATE_FIELDS.VIDEO_CODEC, resolveField(TEMPLATE_FIELDS.VIDEO_CODEC, resolveVideoCodecTag(streamInfos), fieldConfig));
        }
    }
    if (result.includes(TEMPLATE_FIELDS.AUDIO_CODEC)) {
        // Use muxed codec from live TrackComparison if available (e.g. "OPUS" after opusenc)
        if (trackComparisons) {
            const audioComp = trackComparisons.find(c => c.codecType === 'audio');
            result = result.replace(TEMPLATE_FIELDS.AUDIO_CODEC, resolveField(TEMPLATE_FIELDS.AUDIO_CODEC, audioComp?.muxedCodec ?? resolveAudioCodecTag(streamInfos), fieldConfig));
        } else {
            result = result.replace(TEMPLATE_FIELDS.AUDIO_CODEC, resolveField(TEMPLATE_FIELDS.AUDIO_CODEC, resolveAudioCodecTag(streamInfos), fieldConfig));
        }
    }
    if (result.includes(TEMPLATE_FIELDS.VIDEO_HEIGHT)) {
        result = result.replace(TEMPLATE_FIELDS.VIDEO_HEIGHT, resolveField(TEMPLATE_FIELDS.VIDEO_HEIGHT, resolveVideoHeightTag(streamInfos), fieldConfig));
    }
    if (result.includes(TEMPLATE_FIELDS.DUAL_AUDIO)) {
        result = result.replace(TEMPLATE_FIELDS.DUAL_AUDIO, resolveField(TEMPLATE_FIELDS.DUAL_AUDIO, resolveDualAudioTag(streamInfos), fieldConfig));
    }

    // Strip any remaining unreplaced template tokens (e.g. {{EPISODE_NAME}} when no name available)
    // Also clean up surrounding " - " or " " artifacts from removed tokens
    result = result.replace(/\s*\{\{[A-Z_]+\}\}\s*/g, ' ').trim();
    result = result.replace(/\s{2,}/g, ' ');

    return result;
}
