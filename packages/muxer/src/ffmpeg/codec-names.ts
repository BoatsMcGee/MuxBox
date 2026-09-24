import {
    type AVCodecID,
    AV_CODEC_ID_AV1,
    AV_CODEC_ID_H264,
    AV_CODEC_ID_HEVC,
    AV_CODEC_ID_MPEG4,
    AV_CODEC_ID_MPEG2VIDEO,
    AV_CODEC_ID_MPEG2TS,
    AV_CODEC_ID_FFV1,
    AV_CODEC_ID_OPUS,
    AV_CODEC_ID_AAC,
    avGetCodecName,
    AV_CODEC_ID_AC3,
    AV_CODEC_ID_EAC3,
    AV_CODEC_ID_FLAC,
    AV_CODEC_ID_PCM_S16LE,
    AV_CODEC_ID_PCM_S16BE,
    AV_CODEC_ID_PCM_U16LE,
    AV_CODEC_ID_PCM_U16BE,
    AV_CODEC_ID_PCM_S8,
    AV_CODEC_ID_PCM_U8,
    AV_CODEC_ID_PCM_MULAW,
    AV_CODEC_ID_PCM_ALAW,
    AV_CODEC_ID_PCM_S32LE,
    AV_CODEC_ID_PCM_S32BE,
    AV_CODEC_ID_PCM_U32LE,
    AV_CODEC_ID_PCM_U32BE,
    AV_CODEC_ID_PCM_S24LE,
    AV_CODEC_ID_PCM_S24BE,
    AV_CODEC_ID_PCM_U24LE,
    AV_CODEC_ID_PCM_U24BE,
    AV_CODEC_ID_PCM_S24DAUD,
    AV_CODEC_ID_PCM_ZORK,
    AV_CODEC_ID_PCM_S16LE_PLANAR,
    AV_CODEC_ID_PCM_DVD,
    AV_CODEC_ID_PCM_F32BE,
    AV_CODEC_ID_PCM_F32LE,
    AV_CODEC_ID_PCM_F64BE,
    AV_CODEC_ID_PCM_F64LE,
    AV_CODEC_ID_PCM_BLURAY,
    AV_CODEC_ID_PCM_LXF,
    AV_CODEC_ID_PCM_S8_PLANAR,
    AV_CODEC_ID_PCM_S24LE_PLANAR,
    AV_CODEC_ID_PCM_S32LE_PLANAR,
    AV_CODEC_ID_PCM_S16BE_PLANAR,
    AV_CODEC_ID_PCM_S64LE,
    AV_CODEC_ID_PCM_S64BE,
    AV_CODEC_ID_PCM_F16LE,
    AV_CODEC_ID_PCM_F24LE,
    AV_CODEC_ID_PCM_VIDC,
    AV_CODEC_ID_PCM_SGA,
    AV_CODEC_ID_WAVPACK,
    AV_CODEC_ID_SRT,
    AV_CODEC_ID_HDMV_PGS_SUBTITLE,
    AV_CODEC_ID_SSA,
    AV_CODEC_ID_ASS,
    AV_CODEC_ID_SUBRIP,
    AV_CODEC_ID_DVD_SUBTITLE,
    AV_CODEC_ID_VORBIS,
    AV_CODEC_ID_MOV_TEXT,
    AV_CODEC_ID_WEBVTT,
} from 'node-av';

export function getCodecName(codecID: AVCodecID): string | null {
    switch (codecID) {
        case AV_CODEC_ID_AV1: return 'AV1';
        case AV_CODEC_ID_H264: return 'AVC';
        case AV_CODEC_ID_HEVC: return 'HEVC';
        case AV_CODEC_ID_MPEG2VIDEO: return 'MPEG2';
        case AV_CODEC_ID_MPEG4: return 'MPEG4';
        case AV_CODEC_ID_MPEG2TS: return 'MPEG2TS';
        case AV_CODEC_ID_FFV1: return 'FFV1';
        case AV_CODEC_ID_OPUS: return 'OPUS';
        case AV_CODEC_ID_VORBIS: return 'VORBIS';
        case AV_CODEC_ID_AAC: return 'AAC';
        case AV_CODEC_ID_AC3 : return 'AC3';
        case AV_CODEC_ID_EAC3 : return 'EAC3';
        case AV_CODEC_ID_FLAC : return 'FLAC';
        case AV_CODEC_ID_PCM_S16LE:
        case AV_CODEC_ID_PCM_S16BE:
        case AV_CODEC_ID_PCM_U16LE:
        case AV_CODEC_ID_PCM_U16BE:
        case AV_CODEC_ID_PCM_S8:
        case AV_CODEC_ID_PCM_U8:
        case AV_CODEC_ID_PCM_MULAW:
        case AV_CODEC_ID_PCM_ALAW:
        case AV_CODEC_ID_PCM_S32LE:
        case AV_CODEC_ID_PCM_S32BE:
        case AV_CODEC_ID_PCM_U32LE:
        case AV_CODEC_ID_PCM_U32BE:
        case AV_CODEC_ID_PCM_S24LE:
        case AV_CODEC_ID_PCM_S24BE:
        case AV_CODEC_ID_PCM_U24LE:
        case AV_CODEC_ID_PCM_U24BE:
        case AV_CODEC_ID_PCM_S24DAUD:
        case AV_CODEC_ID_PCM_ZORK:
        case AV_CODEC_ID_PCM_S16LE_PLANAR:
        case AV_CODEC_ID_PCM_DVD:
        case AV_CODEC_ID_PCM_F32BE:
        case AV_CODEC_ID_PCM_F32LE:
        case AV_CODEC_ID_PCM_F64BE:
        case AV_CODEC_ID_PCM_F64LE:
        case AV_CODEC_ID_PCM_BLURAY:
        case AV_CODEC_ID_PCM_LXF:
        case AV_CODEC_ID_PCM_S8_PLANAR:
        case AV_CODEC_ID_PCM_S24LE_PLANAR:
        case AV_CODEC_ID_PCM_S32LE_PLANAR:
        case AV_CODEC_ID_PCM_S16BE_PLANAR:
        case AV_CODEC_ID_PCM_S64LE:
        case AV_CODEC_ID_PCM_S64BE:
        case AV_CODEC_ID_PCM_F16LE:
        case AV_CODEC_ID_PCM_F24LE:
        case AV_CODEC_ID_PCM_VIDC:
        case AV_CODEC_ID_PCM_SGA: return 'PCM';
        case AV_CODEC_ID_WAVPACK: return 'WAVPACK';
        case AV_CODEC_ID_SRT: return 'SRT';
        case AV_CODEC_ID_HDMV_PGS_SUBTITLE: return 'PGS';
        case AV_CODEC_ID_SSA: return 'SSA';
        case AV_CODEC_ID_ASS: return 'ASS';
        case AV_CODEC_ID_SUBRIP: return 'SUBRIP';
        case AV_CODEC_ID_DVD_SUBTITLE: return 'DVD';
        case AV_CODEC_ID_MOV_TEXT: return 'MOV';
        case AV_CODEC_ID_WEBVTT: return 'WEBVTT';
        default: return avGetCodecName(codecID);
    }
}