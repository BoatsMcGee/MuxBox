import {
    AV_CODEC_ID_H264,
    AV_CODEC_ID_HEVC,
    AV_CODEC_ID_AV1,
    AV_CODEC_ID_MPEG4,
    AV_CODEC_ID_MPEG2VIDEO,
    AV_CODEC_ID_MPEG2TS,
    AV_CODEC_ID_FFV1,
    AV_CODEC_ID_OPUS,
    AV_CODEC_ID_VORBIS,
    AV_CODEC_ID_AAC,
    AV_CODEC_ID_AC3,
    AV_CODEC_ID_EAC3,
    AV_CODEC_ID_FLAC,
    AV_CODEC_ID_PCM_S16LE,
    AV_CODEC_ID_WAVPACK,
    AV_CODEC_ID_DTS,
    AV_CODEC_ID_TRUEHD,
    AV_CODEC_ID_MP3,
    AV_CODEC_ID_HDMV_PGS_SUBTITLE,
    AV_CODEC_ID_SUBRIP,
    AV_CODEC_ID_SSA,
    AV_CODEC_ID_ASS,
    AV_CODEC_ID_DVD_SUBTITLE,
    AV_CODEC_ID_MOV_TEXT,
    AV_CODEC_ID_WEBVTT,
    AV_CODEC_ID_VP8,
    AV_CODEC_ID_VP9,
    AV_CODEC_ID_VC1,
    type AVCodecID,
} from 'node-av';
import * as NodeAvConstants from 'node-av/constants';
import { getCodecName } from './ffmpeg/codec-names.js';

// ─── Codec Constants ─────────────────────────────────────────────
// Shared codec ID constants sourced from node-av, exposed to the renderer
// via the preload context bridge. This eliminates hardcoded FFmpeg values
// in the renderer code.

export interface CodecConstants {
    readonly AV1: number;
    readonly AVC: number;
    readonly HEVC: number;
    readonly MPEG2: number;
    readonly MPEG4: number;
    readonly MPEG2TS: number;
    readonly FFV1: number;
    readonly VP9: number;
    readonly VP8: number;
    readonly VC1: number;
    readonly OPUS: number;
    readonly VORBIS: number;
    readonly AAC: number;
    readonly AC3: number;
    readonly EAC3: number;
    readonly FLAC: number;
    readonly PCM: number;
    readonly WAVPACK: number;
    readonly DTS: number;
    readonly TRUEHD: number;
    readonly MP3: number;
    readonly SRT: number;
    readonly PGS: number;
    readonly SSA: number;
    readonly ASS: number;
    readonly SUBRIP: number;
    readonly DVD: number;
    readonly MOV: number;
    readonly WEBVTT: number;
}

/**
 * Returns the shared codec ID constants sourced from node-av.
 * Used by the renderer via the preload context bridge to avoid
 * hardcoding FFmpeg AVCodecID values.
 */
export function getCodecConstants(): CodecConstants {
    return {
        AV1: AV_CODEC_ID_AV1,
        AVC: AV_CODEC_ID_H264,
        HEVC: AV_CODEC_ID_HEVC,
        MPEG2: AV_CODEC_ID_MPEG2VIDEO,
        MPEG4: AV_CODEC_ID_MPEG4,
        MPEG2TS: AV_CODEC_ID_MPEG2TS,
        FFV1: AV_CODEC_ID_FFV1,
        VP9: AV_CODEC_ID_VP9,
        VP8: AV_CODEC_ID_VP8,
        VC1: AV_CODEC_ID_VC1,
        OPUS: AV_CODEC_ID_OPUS,
        VORBIS: AV_CODEC_ID_VORBIS,
        AAC: AV_CODEC_ID_AAC,
        AC3: AV_CODEC_ID_AC3,
        EAC3: AV_CODEC_ID_EAC3,
        FLAC: AV_CODEC_ID_FLAC,
        PCM: AV_CODEC_ID_PCM_S16LE,
        WAVPACK: AV_CODEC_ID_WAVPACK,
        DTS: AV_CODEC_ID_DTS,
        TRUEHD: AV_CODEC_ID_TRUEHD,
        MP3: AV_CODEC_ID_MP3,
        SRT: AV_CODEC_ID_SUBRIP,
        PGS: AV_CODEC_ID_HDMV_PGS_SUBTITLE,
        SSA: AV_CODEC_ID_SSA,
        ASS: AV_CODEC_ID_ASS,
        SUBRIP: AV_CODEC_ID_SUBRIP,
        DVD: AV_CODEC_ID_DVD_SUBTITLE,
        MOV: AV_CODEC_ID_MOV_TEXT,
        WEBVTT: AV_CODEC_ID_WEBVTT,
    };
}

/**
 * A single codec entry with its numeric ID, constant variable name,
 * and a friendly human-readable name (if known from FFmpeg).
 */
export interface CodecEntry {
    id: number;
    varName: string;
    friendlyName: string | null;
}

/**
 * Returns ALL NodeAV AVCodecID constants as structured entries, discovered
 * dynamically from the node-av module exports.  This ensures every codec
 * constant FFmpeg exposes is represented, regardless of whether `@app/muxer`
 * has a friendly name mapping for it.
 *
 * The `friendlyName` is resolved via `getCodecName()` from @app/muxer.
 * For unknown codec IDs the friendlyName will be null (the caller should
 * fall back to displaying the varName or numeric ID).
 */
export function getCodecEntryList(): CodecEntry[] {
    const entries: CodecEntry[] = [];
    const seen = new Set<number>();
    for (const key of Object.keys(NodeAvConstants)) {
        if (key.startsWith('AV_CODEC_ID_')) {
            const value = (NodeAvConstants as Record<string, unknown>)[key];
            if (typeof value === 'number' && !seen.has(value)) {
                seen.add(value);
                entries.push({
                    id: value,
                    varName: key,
                    friendlyName: getCodecName(value as AVCodecID),
                });
            }
        }
    }
    return entries.sort((a, b) => a.id - b.id);
}
