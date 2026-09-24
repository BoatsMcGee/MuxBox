import {
    Demuxer,
    AVMEDIA_TYPE_VIDEO,
    AVMEDIA_TYPE_AUDIO,
} from 'node-av';
import { acquireFfmpegSemaphore, releaseFfmpegSemaphore } from './ffmpeg/concurrency.js';
import { getStreamTracks } from '@app/mediainfo';
import { identifyFile, parseChaptersFromMkvinfo } from '@app/mkvtoolnix';
import { getCodecName } from './ffmpeg/codec-names.js';
import { ALL_DISPOSITIONS } from './sorter/index.js';
import type { StreamInfo } from './episode/progress.js';

// ─── Probe Cache ──────────────────────────────────────────────
// Caches StreamInfo[] per file path so repeated builds don't re-probe.
// Cleared on project switch via clearProbeCache().

const probeCache = new Map<string, StreamInfo[]>();

/**
 * Get StreamInfo[] for a file, using cached result if available.
 * Opens the Demuxer, reads stream info + dispositions, runs MediaInfo
 * augmentation for BCP‑47 language, then closes the Demuxer immediately.
 * No native resources are held after this call.
 */
export async function demuxStreams(filePath: string): Promise<StreamInfo[]> {
    const cached = probeCache.get(filePath);
    if (cached) return cached;

    const result = await _demuxStreams(filePath);
    probeCache.set(filePath, result);
    return result;
}

/**
 * Clear the probe cache. Called when switching projects or when source files
 * may have changed.
 */
export function clearProbeCache(): void {
    probeCache.clear();
}

/**
 * Internal: demux a media file and extract serializable stream information using node-av.
 * MediaInfo is used only for BCP-47 language augmentation where available.
 *
 * This opens the file, reads stream headers/metadata, and immediately closes it.
 * No media packets are decoded — only file headers are parsed.
 *
 * @param filePath - Path to the media file
 * @returns Array of serializable StreamInfo objects
 */
async function _demuxStreams(filePath: string): Promise<StreamInfo[]> {
    // ─── Fast path: try mkvmerge -J for language + extra data ──
    // mkvmerge is typically sub-second for identification. If it works
    // we skip the slow mediainfo.js WASM cold-start entirely.
    type MkvLangExtra = { language?: string; properties?: Record<string, unknown> };
    let mkvLangMap: Map<number, MkvLangExtra> | undefined;
    let mkvContainerProps: Record<string, unknown> | undefined;

    const identResult = await identifyFile(filePath);
    if (identResult) {
        mkvLangMap = new Map();
        for (const track of identResult.tracks ?? []) {
            if (track.id == null) continue;
            const props = track.properties;
            let effectiveLang: string | undefined;
            if (props) {
                const lang = props.language;
                const langIetf = props.language_ietf;
                // Prefer IETF when it's >= the length of ISO 639-2 (e.g. "en-US" beats "eng",
                // but "jpn" beats "ja").
                // Filter "und" (undefined) — treat as no value set.
                if (langIetf && lang && langIetf.length >= lang.length && !isUnd(langIetf)) {
                    effectiveLang = langIetf;
                } else if (lang && !isUnd(lang)) {
                    effectiveLang = lang;
                } else if (langIetf && !isUnd(langIetf)) {
                    effectiveLang = langIetf;
                }
            }
            mkvLangMap.set(track.id, {
                language: effectiveLang,
                properties: props as Record<string, unknown> | undefined,
            });
        }

        // Extract container-level properties from mkvmerge
        if (identResult.container?.properties) {
            const cp = identResult.container.properties as Record<string, unknown>;
            const filtered: Record<string, unknown> = {};
            for (const [key, val] of Object.entries(cp)) {
                if (val != null && val !== '') filtered[key] = val;
            }
            if (Object.keys(filtered).length > 0) {
                mkvContainerProps = filtered;
            }
        }
    }

    // ─── If mkvmerge identified chapters, augment with mkvinfo ──
    // mkvmerge -J only reports chapter count per edition, not names/timestamps.
    // mkvinfo text output has the full details — parse it when needed.
    let mkvChapters: Record<string, string> | undefined;
    const hasChapters = identResult && identResult.chapters && identResult.chapters.length > 0;
    if (hasChapters) {
        try {
            const parsedChapters = await parseChaptersFromMkvinfo(filePath);
            if (parsedChapters.length > 0) {
                mkvChapters = {};
                for (const ch of parsedChapters) {
                    // Store using the same format as mediainfo chapters
                    const label = ch.language ? `${ch.language}:${ch.title}` : ch.title;
                    mkvChapters[ch.timestamp] = label;
                }
            }
        } catch {
            // mkvinfo is optional — proceed without chapters
        }
    }

    // ─── Slow path: run MediaInfo if mkvmerge didn't work ──────
    let mediaInfoExtraMap: Map<number, Record<string, unknown>> | undefined;
    let mediaInfoMenuTracks: Record<string, unknown>[] | undefined;
    if (!identResult) {
        try {
            const tracks = await getStreamTracks(filePath);
            if (tracks) {
                mediaInfoExtraMap = new Map();
                for (const [idx, track] of tracks) {
                    // Serialize Track to plain object for IPC
                    const raw = JSON.parse(JSON.stringify(track)) as Record<string, unknown>;
                    if (idx < 0) continue; // General track (-1) - skip, use node-av demuxer metadata instead
                    const trackType = raw['@type'] ?? raw['StreamKind'] ?? raw['StreamKind_String'];
                    if (typeof trackType === 'string' && trackType.toLowerCase() === 'menu') {
                        if (!mediaInfoMenuTracks) mediaInfoMenuTracks = [];
                        mediaInfoMenuTracks.push(raw);
                        continue;
                    }
                    mediaInfoExtraMap.set(idx, raw);
                }
            }
        } catch {
            // MediaInfo is optional — proceed without it
        }
    }

    // ─── Acquire semaphore and open demuxer ─────────────────────
    await acquireFfmpegSemaphore();
    let demuxer;
    try {
        demuxer = await Demuxer.open(filePath, { signal: AbortSignal.timeout(180_000) });
        const nativeStreams = demuxer.streams;
        const streamInfos: StreamInfo[] = [];

        // Capture container-level metadata from node-av demuxer (FFmpeg format context).
        // This includes tags like title, encoder, writing application, etc.
        let containerMeta: Record<string, unknown> | undefined =
            demuxer.metadata && Object.keys(demuxer.metadata).length > 0
                ? { ...demuxer.metadata }
                : undefined;

        // Merge mkvmerge container properties if available (enriches demuxer metadata)
        if (mkvContainerProps) {
            containerMeta ??= {};
            Object.assign(containerMeta, mkvContainerProps);
        }

        // If we have mkvinfo chapters (from mkvmerge fast path), use them.
        // Otherwise fall back to MediaInfo Menu tracks (when using mediainfo fallback).
        if (mkvChapters) {
            containerMeta ??= {};
            containerMeta['_Chapters'] = mkvChapters;
        } else if (mediaInfoMenuTracks && mediaInfoMenuTracks.length > 0) {
            const chapterEntries: Record<string, string> = {};
            for (const menu of mediaInfoMenuTracks) {
                const extra = menu['extra'] as Record<string, unknown> | undefined;
                if (extra) {
                    for (const [key, val] of Object.entries(extra)) {
                        if (key.startsWith('_') && typeof val === 'string' && val) {
                            chapterEntries[key] = val;
                        }
                    }
                }
            }
            if (Object.keys(chapterEntries).length > 0) {
                containerMeta ??= {};
                containerMeta['_Chapters'] = chapterEntries;
            }
        }

        for (const stream of nativeStreams) {
            const codecpar = stream.codecpar;
            const codecType = codecpar.codecType;
            const codecId = codecpar.codecId;
            const codecName = getCodecName(codecId) ?? 'Unknown';

            // Extract node-av metadata
            const metadata: Record<string, string> = {};
            const dict = stream.metadata;
            if (dict) {
                const all = dict.getAll();
                Object.assign(metadata, all);
            }

            // Resolve extra data and language from whichever source succeeded
            let extra: Record<string, unknown> | undefined;
            const mkvLangInfo = mkvLangMap?.get(stream.index);
            if (mkvLangInfo) {
                // Data from mkvmerge
                if (mkvLangInfo.properties) {
                    extra = mkvLangInfo.properties;
                }
                if (mkvLangInfo.language) {
                    metadata['language'] = mkvLangInfo.language;
                }
            } else {
                // Fallback to MediaInfo data
                const mediaInfoExtra = mediaInfoExtraMap?.get(stream.index);
                extra = mediaInfoExtra;
                if (mediaInfoExtra) {
                    const langRaw = mediaInfoExtra['Language'];
                    const langRaw3 = mediaInfoExtra['Language_String3'];
                    const bcp47Lang = typeof langRaw === 'string' && langRaw.length > 2 && !isUnd(langRaw)
                        ? langRaw
                        : typeof langRaw3 === 'string' && !isUnd(langRaw3) ? langRaw3 : undefined;
                    if (bcp47Lang) {
                        metadata['language'] = bcp47Lang;
                    }
                }
            }

            // Extract dispositions
            const dispositions: number[] = [];
            for (const disp of ALL_DISPOSITIONS) {
                if (stream.hasDisposition(disp)) {
                    dispositions.push(disp);
                }
            }

            // Build stream info
            const info: StreamInfo = {
                index: stream.index,
                codecType,
                codecId,
                codecName,
                metadata,
                dispositions,
                extra,
            };

            // Type-specific properties
            if (codecType === AVMEDIA_TYPE_VIDEO) {
                info.width = codecpar.width;
                info.height = codecpar.height;
                try {
                    const json = codecpar.toJSON();
                    info.fieldOrder = json?.fieldOrder as number | undefined;
                } catch {
                    // fieldOrder not available — leave undefined
                }
            } else if (codecType === AVMEDIA_TYPE_AUDIO) {
                info.channels = codecpar.channels;
                info.sampleRate = codecpar.sampleRate;
            }

            // Common properties
            const bitRate = Number(codecpar.bitRate);
            if (bitRate > 0) {
                info.bitRate = bitRate;
            }

            if (demuxer.duration > 0) {
                info.duration = demuxer.duration;
            }

            streamInfos.push(info);
        }

        // Attach container-level metadata to the first stream
        if (containerMeta && streamInfos.length > 0) {
            streamInfos[0].containerMeta = containerMeta;
        }

        return streamInfos;
    } finally {
        if (demuxer) demuxer.close();
        releaseFfmpegSemaphore();
    }
}

/**
 * Check if a language value is "und" (undefined) — treat as absent.
 * Used consistently for both mkvmerge and mediainfo language values.
 */
function isUnd(val: string | undefined): boolean {
    return val === undefined || val === 'und';
}
