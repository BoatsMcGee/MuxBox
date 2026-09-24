/**
 * Shared property extraction and preprocess effect prediction for stream matching.
 *
 * Two extractors populate `StreamProperties`:
 * - `extractNativeStreamProperties` — from a live node-av `Stream` (used by BaseSelector)
 * - `extractInfoStreamProperties`   — from serialized `StreamInfo` (used by simulator)
 *
 * The extracted properties are consumed by the shared `evaluateStreamMatch()` function,
 * ensuring match evaluation is identical regardless of data source.
 */

import {
    type Stream,
    type AVCodecID,
    type AVDisposition,
    AV_CODEC_ID_OPUS,
    AV_DICT_MATCH_CASE,
    AVMEDIA_TYPE_AUDIO,
} from 'node-av';
import { getTrackLanguage, type MediaInfoTrackMap } from '@app/mediainfo';
import { getCodecName } from '../ffmpeg/codec-names.js';
import {
    type AudioPreprocess,
    type VideoPreprocess,
} from './types.js';
import { type StreamInfo } from './progress.js';

// ─── StreamProperties ────────────────────────────────────────

/**
 * Minimal stream property surface consumed by `evaluateStreamMatch()`.
 * Both extractors below produce this shape.
 */
export interface StreamProperties {
    index: number;
    codecId: AVCodecID;
    /** AVMEDIA_TYPE_* constant. */
    codecType: number;
    codecName: string | undefined;
    title: string | undefined;
    language: string | undefined;
    hasDisposition(flag: AVDisposition): boolean;
    duration: number | undefined;
    width: number | undefined;
    height: number | undefined;
    channels: number | undefined;
    bitRate: number | undefined;
    metadata: Record<string, string>;
}

// ─── Native Stream extractor (for BaseSelector) ──────────────

/**
 * Build StreamProperties from a live node-av Stream.
 * MediaInfo augments the language with BCP‑47 / ISO 639‑2 if available.
 * The demuxer is needed for the container duration (used by `size` match).
 */
export function extractNativeStreamProperties(
    stream: Stream,
    demuxer?: { duration: number },
    mediaInfo?: MediaInfoTrackMap,
): StreamProperties {
    const codecpar = stream.codecpar;
    const codecId = codecpar.codecId as AVCodecID;

    // Language with MediaInfo augmentation
    const track = mediaInfo?.get(stream.index);
    const mediaInfoLanguage = track ? getTrackLanguage(track) : undefined;
    const ffmpegLanguage = stream.metadata?.get('language', AV_DICT_MATCH_CASE) ?? undefined;
    const language = mediaInfoLanguage?.Language?.length && mediaInfoLanguage.Language.length > 2
        ? mediaInfoLanguage.Language
        : mediaInfoLanguage?.Language_String3 ?? ffmpegLanguage;

    const meta = stream.metadata?.getAll() ?? {};

    return {
        index: stream.index,
        codecId,
        codecType: codecpar.codecType,
        codecName: getCodecName(codecId) ?? undefined,
        title: meta['title'] ?? undefined,
        language: language ?? undefined,
        hasDisposition: (flag: AVDisposition) => stream.hasDisposition(flag),
        duration: demuxer?.duration ? Number(demuxer.duration) : undefined,
        width: codecpar.width ?? undefined,
        height: codecpar.height ?? undefined,
        channels: codecpar.channels ?? undefined,
        bitRate: Number(codecpar.bitRate) > 0 ? Number(codecpar.bitRate) : undefined,
        metadata: meta,
    };
}

// ─── StreamInfo extractor (for simulation) ───────────────────

/**
 * Build StreamProperties from cached StreamInfo data.
 *
 * StreamInfo already contains BCP‑47-augmented language (set during demuxStreams
 * in the preload layer where MediaInfo runs). The dispositions array carries
 * numeric AV_DISPOSITION_* flags that can be tested with .includes().
 */
export function extractInfoStreamProperties(info: StreamInfo): StreamProperties {
    const meta = info.metadata ?? {};
    const dispositions = info.dispositions ?? [];

    return {
        index: info.index,
        codecId: info.codecId as AVCodecID,
        codecType: info.codecType,
        codecName: info.codecName,
        title: meta['title'] ?? undefined,
        language: meta['language'] ?? undefined,
        hasDisposition: (flag: AVDisposition) => dispositions.includes(Number(flag)),
        duration: info.duration,
        width: info.width,
        height: info.height,
        channels: info.channels,
        bitRate: info.bitRate,
        metadata: meta,
    };
}

// ─── Preprocess effect prediction ────────────────────────────

export interface PreprocessEffect {
    codecId: AVCodecID;
    codecName: string;
    codecType: number;
}

/**
 * Predict the post-preprocess properties of a stream.
 *
 * The simulation uses this to predict what codec a stream will become after
 * preprocessing (e.g., opusenc → Opus). The actual encoding only happens
 * during real muxing — this just ensures the UI model matches reality.
 */
export function simulatePreprocessEffect(
    preprocess: AudioPreprocess | VideoPreprocess,
): PreprocessEffect | undefined {
    if ('opusenc' in preprocess && preprocess.opusenc) {
        return {
            codecId: AV_CODEC_ID_OPUS as AVCodecID,
            codecName: 'Opus',
            codecType: AVMEDIA_TYPE_AUDIO,
        };
    }
    if ('grav1synth' in preprocess && preprocess.grav1synth) {
        // Placeholder — grav1synth not yet implemented, no change predicted
        return undefined;
    }
    return undefined;
}
