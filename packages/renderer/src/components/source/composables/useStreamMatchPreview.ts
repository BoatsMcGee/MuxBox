/**
 * Composable for StreamMatchPreview — extracts all helper/computation logic
 * from the preview components into a single shared composable.
 */
import type { MatchedTrack } from '@/lib/stream-match';
import { getCodecLabel, DISPOSITION_LABEL_MAP } from '@/lib/stream-match';
import type { StreamInfo } from '@app/preload';
import { DISPOSITION_OPTIONS } from '@/components/source/config/disposition-options';
import { formatBitrate, formatDuration, formatFileSize } from '@/components/source/utils/format-media';
import type { FilePreviewState, FileEpisodeInfo } from '@/components/source/types/stream-match-types';


export interface DetailRow {
    label: string;
    value: string;
    changed?: boolean;
    before?: string;
    after?: string;
    dispItems?: { label: string; status: 'kept' | 'added' | 'removed' }[];
    overridable?: boolean;
    overridden?: boolean;
    overrideField?: string;
    overrideValue?: unknown;
}

export interface TagEntry {
    key: string;
    value: string;
}

export interface ParsedChapter {
    rawKey: string;
    timestamp: string;
    /** Original timestamp before delay is applied. Equals `timestamp` when delay is 0. */
    originalTimestamp?: string;
    /** Effective delay in milliseconds applied to this chapter. */
    delayMs?: number;
    title: string;
    language?: string;
}

// ─── Chapter delay helpers ───────────────────────────────────

/** Resolve the effective chapter delay for a file (per-file map, default 0). */
export function getEffectiveChapterDelay(
    file: string,
    perFileChapterDelay: Record<string, number> | undefined,
): number {
    return perFileChapterDelay?.[file] ?? 0;
}

/** Parse an "HH:MM:SS.mmm" timestamp into milliseconds. Returns null when unparseable. */
export function parseChapterTimestampToMs(timestamp: string): number | null {
    const match = timestamp.match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const millis = Number(match[4]!.padEnd(3, '0'));
    if ([hours, minutes, seconds, millis].some((n) => Number.isNaN(n))) return null;
    return ((hours * 3600 + minutes * 60 + seconds) * 1000) + millis;
}

/** Format milliseconds as "HH:MM:SS.mmm", clipping negatives to zero. */
export function formatChapterTimestamp(ms: number): string {
    const clipped = Math.max(0, Math.round(ms));
    const hours = Math.floor(clipped / 3600000);
    const minutes = Math.floor((clipped % 3600000) / 60000);
    const seconds = Math.floor((clipped % 60000) / 1000);
    const millis = clipped % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** Shift a chapter timestamp by a delay in milliseconds. Unparseable timestamps pass through. */
export function shiftChapterTimestamp(timestamp: string, delayMs: number): string {
    if (!delayMs) return timestamp;
    const base = parseChapterTimestampToMs(timestamp);
    if (base === null) return timestamp;
    return formatChapterTimestamp(base + delayMs);
}

// ─── Per-file lookup helpers ─────────────────────────────────

export function isFileMetadataEnabled(
    file: string,
    perFileMetadata: Record<string, boolean> | undefined,
): boolean {
    return perFileMetadata?.[file] ?? false;
}

export function isFileChaptersEnabled(
    file: string,
    perFileChapters: Record<string, boolean> | undefined,
): boolean {
    return perFileChapters?.[file] ?? false;
}

// ─── Episode info helpers ───────────────────────────────────

export function getEpisodeInfo(
    file: string,
    perFileEpisodeInfo: Record<string, FileEpisodeInfo | null> | undefined,
): FileEpisodeInfo | null {
    return perFileEpisodeInfo?.[file] ?? null;
}

export function getEffectiveSeason(
    file: string,
    perFileEpisodeInfo: Record<string, FileEpisodeInfo | null> | undefined,
    perFileSeasonOverride: Record<string, number | null> | undefined,
): number | null {
    const override = perFileSeasonOverride?.[file];
    if (override != null) return override;
    return perFileEpisodeInfo?.[file]?.season ?? null;
}

export function getEffectiveEpisode(
    file: string,
    perFileEpisodeInfo: Record<string, FileEpisodeInfo | null> | undefined,
    perFileEpisodeOverride: Record<string, number | null> | undefined,
): number | null {
    const override = perFileEpisodeOverride?.[file];
    if (override != null) return override;
    return perFileEpisodeInfo?.[file]?.episode ?? null;
}

export function hasEpisodeOverride(
    file: string,
    perFileSeasonOverride: Record<string, number | null> | undefined,
    perFileEpisodeOverride: Record<string, number | null> | undefined,
): boolean {
    return (perFileSeasonOverride?.[file] != null) || (perFileEpisodeOverride?.[file] != null);
}

export function padEpisodeNum(n: number): string {
    return String(n).padStart(2, '0');
}

// ─── Per-track modifier helpers ────────────────────────────

export function getTrackModifier(
    perTrackModifiersByFile: Record<string, Record<number, Record<string, unknown>>> | undefined,
    file: string,
    trackIdx: number,
    field: string,
): unknown {
    return perTrackModifiersByFile?.[file]?.[trackIdx]?.[field];
}

export function activeDispositionsRaw(
    perTrackModifiersByFile: Record<string, Record<number, Record<string, unknown>>> | undefined,
    file: string,
    trackIdx: number,
): Record<string, boolean> {
    return { ...((perTrackModifiersByFile?.[file]?.[trackIdx]?.disposition as Record<string, boolean>) ?? {}) };
}

export function activeDispositions(
    perTrackModifiersByFile: Record<string, Record<number, Record<string, unknown>>> | undefined,
    file: string,
    trackIdx: number,
): { key: string; label: string; value: boolean }[] {
    const disp = getTrackModifier(perTrackModifiersByFile, file, trackIdx, 'disposition') as Record<string, boolean> | undefined;
    if (!disp) return [];
    return Object.entries(disp).map(([key, value]) => ({
        key,
        label: DISPOSITION_OPTIONS.find(d => d.value === key)?.label ?? `Disp ${key}`,
        value,
    }));
}

export function availableDispositions(
    perTrackModifiersByFile: Record<string, Record<number, Record<string, unknown>>> | undefined,
    file: string,
    trackIdx: number,
): { value: string; label: string }[] {
    const used = new Set(Object.keys(
        (getTrackModifier(perTrackModifiersByFile, file, trackIdx, 'disposition') as Record<string, boolean>) ?? {},
    ));
    return DISPOSITION_OPTIONS.filter(d => !used.has(d.value));
}

export function activeTagsRaw(
    perTrackModifiersByFile: Record<string, Record<number, Record<string, unknown>>> | undefined,
    file: string,
    trackIdx: number,
): Record<string, string> {
    return { ...((perTrackModifiersByFile?.[file]?.[trackIdx]?.tags as Record<string, string>) ?? {}) };
}

// ─── Helper to compute a new tags object with one added entry ──

export function computeNewTag(
    perTrackModifiersByFile: Record<string, Record<number, Record<string, unknown>>> | undefined,
    file: string,
    trackIdx: number,
): Record<string, string> {
    const current = { ...((perTrackModifiersByFile?.[file]?.[trackIdx]?.tags as Record<string, string>) ?? {}) };
    let idx = 1;
    while (current[`tag${idx}`] !== undefined) idx++;
    current[`tag${idx}`] = '';
    return current;
}

export function activeTags(
    perTrackModifiersByFile: Record<string, Record<number, Record<string, unknown>>> | undefined,
    file: string,
    trackIdx: number,
): TagEntry[] {
    const tags = getTrackModifier(perTrackModifiersByFile, file, trackIdx, 'tags') as Record<string, string> | undefined;
    if (!tags) return [];
    return Object.entries(tags).map(([key, value]) => ({ key, value }));
}

// ─── Track exclusion ───────────────────────────────────────

export function isTrackExcluded(
    file: string,
    trackIdx: number,
    excludedTracksByFile: Record<string, Set<number>> | undefined,
): boolean {
    return excludedTracksByFile?.[file]?.has(trackIdx) ?? false;
}

// ─── Stream details computation ─────────────────────────────

function getNumValue(
    mi: Record<string, unknown> | undefined,
    miKey: string,
    fallback: number | undefined,
): number | undefined {
    if (mi) {
        const v = mi[miKey];
        if (v != null) {
            const n = Number(v);
            if (!Number.isNaN(n) && n > 0) return n;
        }
    }
    return fallback && fallback > 0 ? fallback : undefined;
}

export function hasModifications(track: MatchedTrack): boolean {
    return track.modify !== undefined || track.preprocess !== undefined;
}

/** Effective header values for a matched track row (codec/language/title). */
export interface TrackHeaderValues {
    codec: string;
    language: string;
    title: string;
    codecChanged: boolean;
    languageChanged: boolean;
    titleChanged: boolean;
}

/**
 * Compute the effective codec/language/title for a track row header.
 * Precedence: per-track override > modify config > original source value.
 * The `*Changed` flags let the header highlight modified values distinctly.
 */
export function getTrackHeaderValues(
    track: MatchedTrack,
    file: string,
    perTrackModifiersByFile: Record<string, Record<number, Record<string, unknown>>> | undefined,
): TrackHeaderValues {
    const info = track.streamInfo;
    const modify = track.modify;
    const preprocess = track.preprocess;

    // Codec: opusenc preprocess re-encodes the stream to OPUS.
    const opusenc = preprocess?.opusenc as Record<string, unknown> | undefined;
    const codec = opusenc ? 'OPUS' : track.codec;
    const codecChanged = opusenc !== undefined;

    // Title: override > modify > original.
    const origTitle = info.metadata['title'] ?? '';
    const ovrTitle = getTrackModifier(perTrackModifiersByFile, file, track.index, 'title') as string | undefined;
    const modTitle = modify?.title as string | undefined;
    const effectiveTitle = ovrTitle !== undefined ? ovrTitle : (typeof modTitle === 'string' ? modTitle : origTitle);
    const titleChanged = effectiveTitle !== origTitle;

    // Language: override > modify > original.
    const origLang = info.metadata['language'] ?? '';
    const ovrLang = getTrackModifier(perTrackModifiersByFile, file, track.index, 'language') as string | undefined;
    const modLang = modify?.language as string | undefined;
    const effectiveLang = ovrLang !== undefined ? ovrLang : (typeof modLang === 'string' ? modLang : origLang);
    const languageChanged = effectiveLang !== origLang;

    return {
        codec,
        language: effectiveLang,
        title: effectiveTitle,
        codecChanged,
        languageChanged,
        titleChanged,
    };
}

export function getStreamDetails(
    info: StreamInfo,
    modify: Record<string, unknown> | undefined,
    preprocess: Record<string, unknown> | undefined,
    file: string,
    trackIdx: number,
    perTrackModifiersByFile: Record<string, Record<number, Record<string, unknown>>>,
): DetailRow[] {
    const type = info.codecType;
    const details: DetailRow[] = [];
    const mi = info.extra as Record<string, unknown> | undefined;
    const opusenc = preprocess?.opusenc as Record<string, unknown> | undefined;

    const bitRate = getNumValue(mi, 'BitRate', info.bitRate)
        ?? getNumValue(mi, 'BitRate_Maximum', undefined);
    const opusBitrate = opusenc?.bitrate as number | undefined;
    const effectiveBitrate = opusBitrate ?? bitRate;
    const duration = info.duration ?? getNumValue(mi, 'Duration', undefined);

    function trackOverride(field: string): unknown {
        return getTrackModifier(perTrackModifiersByFile, file, trackIdx, field);
    }

    const origCodecLabel = getCodecLabel(info.codecId);
    if (opusenc) {
        details.push({ label: 'Codec', value: `${origCodecLabel} → OPUS`, changed: true, before: origCodecLabel, after: 'OPUS' });
    } else {
        details.push({ label: 'Codec', value: origCodecLabel });
    }

    // ─── Title ──────────────────────────────────────────────
    const origTitle = info.metadata['title'];
    const modTitle = modify?.title as string | undefined;
    const ovrTitle = trackOverride('title') as string | undefined;
    const effectiveTitle = ovrTitle !== undefined ? ovrTitle : (typeof modTitle === 'string' ? modTitle : undefined);
    const titleOverridden = ovrTitle !== undefined;
    if (effectiveTitle !== undefined && effectiveTitle !== origTitle) {
        const displayAfter = effectiveTitle || '(empty)';
        details.push({ label: 'Title', value: `${origTitle || '—'} → ${displayAfter}`, changed: true, before: origTitle || '—', after: displayAfter, overridable: true, overridden: titleOverridden, overrideField: 'title', overrideValue: ovrTitle });
    } else if (origTitle) {
        details.push({ label: 'Title', value: origTitle, overridable: true, overridden: titleOverridden, overrideField: 'title', overrideValue: ovrTitle });
    } else {
        details.push({ label: 'Title', value: '—', overridable: true, overridden: titleOverridden, overrideField: 'title', overrideValue: ovrTitle });
    }

    // ─── Language ───────────────────────────────────────────
    const origLang = info.metadata['language'];
    const modLang = modify?.language as string | undefined;
    const ovrLang = trackOverride('language') as string | undefined;
    const effectiveLang = ovrLang !== undefined ? ovrLang : (typeof modLang === 'string' ? modLang : undefined);
    const langOverridden = ovrLang !== undefined;
    if (effectiveLang !== undefined && effectiveLang !== origLang) {
        const displayAfter = effectiveLang || '(empty)';
        details.push({ label: 'Language', value: `${origLang || '—'} → ${displayAfter}`, changed: true, before: origLang || '—', after: displayAfter, overridable: true, overridden: langOverridden, overrideField: 'language', overrideValue: ovrLang });
    } else if (origLang) {
        details.push({ label: 'Language', value: origLang, overridable: true, overridden: langOverridden, overrideField: 'language', overrideValue: ovrLang });
    }

    // ─── Dispositions ───────────────────────────────────────
    if (type !== 2) {
        const modDisp = modify?.disposition as Record<string, unknown> | undefined;
        const ovrDisp = trackOverride('disposition') as Record<string, boolean> | undefined;
        const keptFlags: number[] = [...info.dispositions];
        const addedFlags: number[] = [];
        const removedFlags: number[] = [];
        let dispositionsChanged = false;

        if (modDisp) {
            for (const [key, val] of Object.entries(modDisp)) {
                const flag = Number(key);
                const enabled = typeof val === 'object' && val !== null
                    ? (val as Record<string, boolean>).equal === true
                    : val === true;
                if (enabled) {
                    const idx = keptFlags.indexOf(flag);
                    if (idx < 0) { addedFlags.push(flag); dispositionsChanged = true; }
                } else {
                    const idx = keptFlags.indexOf(flag);
                    if (idx >= 0) { keptFlags.splice(idx, 1); removedFlags.push(flag); dispositionsChanged = true; }
                }
            }
        }
        if (ovrDisp) {
            for (const [key, enabled] of Object.entries(ovrDisp)) {
                const flag = Number(key);
                if (enabled) {
                    const idx = keptFlags.indexOf(flag);
                    if (idx < 0) { addedFlags.push(flag); }
                    const remIdx = removedFlags.indexOf(flag);
                    if (remIdx >= 0) { removedFlags.splice(remIdx, 1); }
                } else {
                    const keepIdx = keptFlags.indexOf(flag);
                    if (keepIdx >= 0) { keptFlags.splice(keepIdx, 1); removedFlags.push(flag); }
                    const addIdx = addedFlags.indexOf(flag);
                    if (addIdx >= 0) { addedFlags.splice(addIdx, 1); }
                }
                dispositionsChanged = true;
            }
        }
        const dispLabel = (f: number) => DISPOSITION_LABEL_MAP[String(f)] ?? `Flag ${f}`;
        const dispItems = [
            ...keptFlags.map(f => ({ label: dispLabel(f), status: 'kept' as const })),
            ...addedFlags.map(f => ({ label: dispLabel(f), status: 'added' as const })),
            ...removedFlags.map(f => ({ label: dispLabel(f), status: 'removed' as const })),
        ];
        if (dispItems.length === 0) {
            details.push({ label: 'Dispositions', value: '—', overridable: true, overridden: ovrDisp !== undefined, overrideField: 'disposition', overrideValue: ovrDisp });
        } else if (dispositionsChanged) {
            details.push({ label: 'Dispositions', value: '', dispItems, changed: true, overridable: true, overridden: ovrDisp !== undefined, overrideField: 'disposition', overrideValue: ovrDisp });
        } else {
            details.push({ label: 'Dispositions', value: dispItems.map(i => i.label).join(', '), overridable: true, overridden: ovrDisp !== undefined, overrideField: 'disposition', overrideValue: ovrDisp });
        }
    }
    if (type === 0) {
        details.push({ label: 'Resolution', value: `${info.width ?? '?'}×${info.height ?? '?'}` });
        if (mi) {
            details.push({ label: 'Aspect Ratio', value: String(mi['DisplayAspectRatio'] ?? '—') });
            details.push({ label: 'Frame Rate', value: String(mi['FrameRate'] ?? '—') });
            details.push({ label: 'Frame Rate Mode', value: String(mi['FrameRate_Mode'] ?? '—') });
            details.push({ label: 'Chroma Subsampling', value: String(mi['ChromaSubsampling'] ?? '—') });
            details.push({ label: 'Bit Depth', value: String(mi['BitDepth'] ?? '—') });
            details.push({ label: 'Scan Type', value: String(mi['ScanType'] ?? '—') });
            details.push({ label: 'Profile', value: String(mi['Format_Profile'] ?? '—') });
            details.push({ label: 'Level', value: String(mi['Format_Level'] ?? '—') });
            details.push({ label: 'Color Space', value: String(mi['ColorSpace'] ?? '—') });
        }
        details.push({ label: 'Bitrate', value: formatBitrate(bitRate) });
        if (mi?.['StreamSize']) {
            details.push({ label: 'Stream Size', value: formatFileSize(Number(mi['StreamSize'])) });
        }
        details.push({ label: 'Duration', value: formatDuration(duration) });
    } else if (type === 1) {
        const downmix = opusenc?.downmix as string | undefined;
        const effectiveChannels = downmix === 'mono' ? 1 : downmix === 'stereo' ? 2 : info.channels;
        if (mi) {
            details.push({ label: 'Channel Layout', value: String(mi['ChannelLayout'] ?? mi['ChannelPositions'] ?? '—') });
            details.push({ label: 'Bit Depth', value: String(mi['BitDepth'] ?? '—') });
            const origCompression = String(mi['Compression_Mode'] ?? '—');
            if (opusenc) {
                details.push({ label: 'Compression', value: `${origCompression} → Lossy`, changed: true, before: origCompression, after: 'Lossy' });
            } else {
                details.push({ label: 'Compression', value: origCompression });
            }
            details.push({ label: 'Bitrate Mode', value: String(mi['BitRate_Mode'] ?? '—') });
        }
        if (downmix && effectiveChannels !== info.channels) {
            details.push({ label: 'Channels', value: `${info.channels ?? '—'} → ${effectiveChannels}`, changed: true, before: String(info.channels ?? '—'), after: String(effectiveChannels) });
        } else {
            details.push({ label: 'Channels', value: String(effectiveChannels ?? '—') });
        }
        details.push({ label: 'Sample Rate', value: info.sampleRate ? `${info.sampleRate / 1000} kHz` : '—' });
        if (opusBitrate) {
            const origBitrateStr = formatBitrate(bitRate);
            const newBitrateStr = formatBitrate(opusBitrate * 1000);
            details.push({ label: 'Bitrate', value: `${origBitrateStr} → ${newBitrateStr}`, changed: true, before: origBitrateStr, after: newBitrateStr });
        } else {
            details.push({ label: 'Bitrate', value: formatBitrate(effectiveBitrate) });
        }
        const miStreamSize = mi?.['StreamSize'];
        if (opusBitrate && duration) {
            const estimatedOpusBytes = (opusBitrate * 1000 * duration) / 8;
            const origBytes = miStreamSize
                ? Number(miStreamSize)
                : ((effectiveBitrate ?? 0) * duration) / 8;
            details.push({ label: 'Stream Size', value: `${formatFileSize(origBytes)} → ${formatFileSize(estimatedOpusBytes)}`, changed: true, before: formatFileSize(origBytes), after: formatFileSize(estimatedOpusBytes) });
        } else if (miStreamSize) {
            details.push({ label: 'Stream Size', value: formatFileSize(Number(miStreamSize)) });
        } else if (effectiveBitrate && duration) {
            const estimatedBytes = (effectiveBitrate * duration) / 8;
            details.push({ label: 'Stream Size (est.)', value: formatFileSize(estimatedBytes) });
        }
        const modDelay = modify?.delay as number | undefined;
        const ovrDelay = trackOverride('delay') as number | undefined;
        const effectiveDelay = ovrDelay !== undefined ? ovrDelay : (modDelay !== undefined ? modDelay : undefined);
        const origDelay = mi?.['Delay'];
        const origDelayStr = origDelay != null ? String(origDelay) : '—';
        if (effectiveDelay != null && effectiveDelay !== 0) {
            details.push({ label: 'Delay (ms)', value: `${origDelayStr} → ${effectiveDelay}`, changed: true, before: origDelayStr, after: String(effectiveDelay), overridable: true, overridden: ovrDelay !== undefined, overrideField: 'delay', overrideValue: ovrDelay });
        } else if (origDelayStr !== '—') {
            details.push({ label: 'Delay (ms)', value: origDelayStr });
        }
        details.push({ label: 'Duration', value: formatDuration(duration) });
    } else if (type === 3) {
        if (mi) {
            details.push({ label: 'Elements', value: String(mi['ElementCount'] ?? '—') });
            details.push({ label: 'Compression', value: String(mi['Compression_Mode'] ?? '—') });
        }
        details.push({ label: 'Bitrate', value: formatBitrate(bitRate) });
        if (mi?.['StreamSize']) {
            details.push({ label: 'Stream Size', value: formatFileSize(Number(mi['StreamSize'])) });
        }
        const modDelay = modify?.delay as number | undefined;
        const ovrDelay = trackOverride('delay') as number | undefined;
        const effectiveDelay = ovrDelay !== undefined ? ovrDelay : (modDelay !== undefined ? modDelay : undefined);
        const origDelay = mi?.['Delay'];
        const origDelayStr = origDelay != null ? String(origDelay) : '—';
        if (effectiveDelay != null && effectiveDelay !== 0) {
            details.push({ label: 'Delay (ms)', value: `${origDelayStr} → ${effectiveDelay}`, changed: true, before: origDelayStr, after: String(effectiveDelay), overridable: true, overridden: ovrDelay !== undefined, overrideField: 'delay', overrideValue: ovrDelay });
        } else if (origDelayStr !== '—') {
            details.push({ label: 'Delay (ms)', value: origDelayStr });
        }
        details.push({ label: 'Duration', value: formatDuration(duration) });
    } else {
        details.push({ label: 'Filename', value: info.metadata['filename'] ?? info.metadata['Filename'] ?? '—' });
        details.push({ label: 'MIME Type', value: info.metadata['mimetype'] ?? info.metadata['MIMEType'] ?? '—' });
    }

    const modTags = modify?.tags as Record<string, string> | undefined;
    const ovrTags = trackOverride('tags') as Record<string, string> | undefined;
    const effectiveTags = ovrTags !== undefined ? ovrTags : modTags;
    if (effectiveTags) {
        const entries = Object.entries(effectiveTags).filter(([, v]) => v !== undefined && v !== null && v !== '');
        if (entries.length > 0) {
            const tagStr = entries.map(([k, v]) => `${k}=${v}`).join(', ');
            const tagsChanged = ovrTags !== undefined || modTags !== undefined;
            details.push({ label: 'Tags', value: tagStr, changed: true, before: tagsChanged ? '—' : undefined, after: tagStr, overridable: true, overridden: ovrTags !== undefined, overrideField: 'tags', overrideValue: ovrTags });
        }
    }

    return details;
}

// ─── Container metadata extraction ──────────────────────────

export function getContainerMetadata(fileState: FilePreviewState): Record<string, string> {
    const containerMeta = fileState.tracks[0]?.streamInfo.containerMeta;
    if (!containerMeta) return {};
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(containerMeta)) {
        if (key.startsWith('_')) continue;
        if (val == null || val === '') continue;
        if (typeof val !== 'string') continue;
        result[key] = val;
    }
    return result;
}

// ─── Chapter extraction from MediaInfo Menu tracks ──────────

function parseChapterTimestamp(rawKey: string): string {
    const parts = rawKey.replace(/^_/, '').split('_');
    if (parts.length !== 4) return rawKey.replace(/_/g, ':');
    const [h, m, s, ms] = parts;
    return `${h}:${m}:${s}.${ms}`;
}

function parseChapterTitle(rawValue: string): { title: string; language?: string } {
    const colonIdx = rawValue.indexOf(':');
    if (colonIdx > 0 && colonIdx <= 4) {
        const prefix = rawValue.slice(0, colonIdx);
        if (/^[a-z]{2,3}$/.test(prefix)) {
            return { title: rawValue.slice(colonIdx + 1).trim() || rawValue, language: prefix };
        }
    }
    return { title: rawValue };
}

export function getParsedChapters(fileState: FilePreviewState, delayMs = 0): ParsedChapter[] {
    const containerMeta = fileState.tracks[0]?.streamInfo.containerMeta;
    if (!containerMeta) return [];
    const rawChapters = containerMeta['_Chapters'] as Record<string, string> | undefined;
    if (!rawChapters) return [];
    const result: ParsedChapter[] = [];
    for (const [key, val] of Object.entries(rawChapters)) {
        if (val && typeof val === 'string') {
            const { title, language } = parseChapterTitle(val);
            const originalTimestamp = parseChapterTimestamp(key);
            const timestamp = shiftChapterTimestamp(originalTimestamp, delayMs);
            result.push({
                rawKey: key,
                timestamp,
                ...(delayMs !== 0 && { originalTimestamp, delayMs }),
                title,
                language,
            });
        }
    }
    result.sort((a, b) => a.rawKey.localeCompare(b.rawKey));
    return result;
}

export function getChapterCount(fileState: FilePreviewState): number {
    return getParsedChapters(fileState).length;
}
