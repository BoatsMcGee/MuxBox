import sanitize from 'sanitize-filename';
import {
    AV_CODEC_ID_AAC,
    AV_CODEC_ID_AC3,
    AV_CODEC_ID_AV1,
    AV_CODEC_ID_EAC3,
    AV_CODEC_ID_FLAC,
    AV_CODEC_ID_H264,
    AV_CODEC_ID_HEVC,
    AV_CODEC_ID_OPUS,
    AV_DICT_MATCH_CASE,
    type Stream,
} from 'node-av';
import { type Episode, type FieldConfig } from '../episode/types.js';

export const TemplateField = {
    SERIES_NAME: '{{SERIES_NAME}}',
    SEASON_NUMBER: '{{SEASON_NUMBER}}',
    EPISODE_NUMBER: '{{EPISODE_NUMBER}}',
    EPISODE_NAME: '{{EPISODE_NAME}}',
    VIDEO_CODEC: '{{VIDEO_CODEC}}',
    AUDIO_CODEC: '{{AUDIO_CODEC}}',
    VIDEO_HEIGHT: '{{VIDEO_HEIGHT}}',
    DUAL_AUDIO: '{{DUAL_AUDIO}}',
} as const;

export type TemplateField = typeof TemplateField[keyof typeof TemplateField];

export interface TemplateTags {
    height?: {
        fieldType: 'Interlaced' | 'Progressive';
        override?: number;
    } | {
        override: string;
    };
    videoCodec?: {
        override?: string;
    };
    audioCodec?: {
        override?: string;
    };
    dualAudio?: {
        override?: string;
    };
    languageList?: {
        override?: string;
    };
}

export const DEFAULT_FILENAME_TEMPLATE = `${TemplateField.SERIES_NAME} - ${TemplateField.SEASON_NUMBER}${TemplateField.EPISODE_NUMBER} - ${TemplateField.EPISODE_NAME}`;

/**
 * Resolve the video codec tag from a stream.
 * Matches the backend conventions: AV1→"AV1", H264→"AVC", HEVC→"HEVC", others→codecTagString.
 */
function resolveVideoCodecTag(videoStream: Stream | undefined): string {
    if (!videoStream) return '';
    switch (videoStream.codecpar.codecId) {
        case AV_CODEC_ID_AV1: return 'AV1';
        case AV_CODEC_ID_H264: return 'AVC';
        case AV_CODEC_ID_HEVC: return 'HEVC';
        default: return videoStream.codecpar.codecTagString ?? '';
    }
}

/**
 * Resolve the audio codec tag from the first audio stream.
 */
function resolveAudioCodecTag(audioStreams: Stream[]): string {
    if (!audioStreams.length) return '';
    switch (audioStreams[0].codecpar.codecId) {
        case AV_CODEC_ID_AAC: return 'AAC';
        case AV_CODEC_ID_OPUS: return 'OPUS';
        case AV_CODEC_ID_AC3: return 'AC3';
        case AV_CODEC_ID_EAC3: return 'EAC3';
        case AV_CODEC_ID_FLAC: return 'FLAC';
        default: return audioStreams[0].codecpar.codecTagString ?? '';
    }
}

/**
 * Resolve the video height tag from a stream (e.g., "1080p", "1080i", "720p").
 * Appends 'i' for interlaced content (AV_FIELD_TT, BB, TB, BT) or 'p' for progressive.
 */
function resolveVideoHeightTag(videoStream: Stream | undefined): string {
    if (!videoStream || !videoStream.codecpar.height) return '';
    // Determine if interlaced via field_order from codec parameters
    let isInterlaced = false;
    try {
        const json = videoStream.codecpar.toJSON();
        const fieldOrder = json?.fieldOrder as number | undefined;
        // AV_FIELD_UNKNOWN=0, AV_FIELD_PROGRESSIVE=1, AV_FIELD_TT=2, BB=3, TB=4, BT=5
        isInterlaced = fieldOrder !== undefined && fieldOrder >= 2;
    } catch {
        // fallback to progressive
    }
    return `${videoStream.codecpar.height}${isInterlaced ? 'i' : 'p'}`;
}

/**
 * Resolve the dual audio tag from audio streams' languages.
 * Returns "Dual Audio" if exactly 2 distinct languages, "Multi Audio" if more.
 */
function resolveDualAudioTag(audioStreams: Stream[]): string {
    if (!audioStreams.length) return '';
    const languageSet = new Set(
        audioStreams
            .map(stream => stream.metadata?.get('language', AV_DICT_MATCH_CASE))
            .filter(language => !!language),
    );
    if (languageSet.size === 2) return 'Dual Audio';
    if (languageSet.size > 2) return 'Multi Audio';
    return '';
}

export function templateFileName(
    template: string,
    series: Episode['series'],
    videoStream: Stream | undefined,
    audioStreams: Stream[],
    subtitleStreams: Stream[],
    tagOptions?: TemplateTags,
    /** Per-field prefix/suffix configuration keyed by template tag. */
    fieldConfig?: Record<string, FieldConfig>,
): string {
    let templatedFileName = template;
    if (templatedFileName.includes(TemplateField.SERIES_NAME)) {
        templatedFileName = templatedFileName.replace(TemplateField.SERIES_NAME, sanitize(series.name));
    }
    if (templatedFileName.includes(TemplateField.SEASON_NUMBER)) {
        const pad = fieldConfig?.[TemplateField.SEASON_NUMBER]?.padding ?? 2;
        templatedFileName = templatedFileName.replace(`${TemplateField.SEASON_NUMBER}`, resolveField(TemplateField.SEASON_NUMBER, `${series.season.number}`.padStart(pad, '0'), fieldConfig));
    }
    if (templatedFileName.includes(TemplateField.EPISODE_NUMBER)) {
        const pad = fieldConfig?.[TemplateField.EPISODE_NUMBER]?.padding ?? 2;
        templatedFileName = templatedFileName.replace(TemplateField.EPISODE_NUMBER, resolveField(TemplateField.EPISODE_NUMBER, `${series.episode.number}`.padStart(pad, '0'), fieldConfig));
    }
    if (templatedFileName.includes(TemplateField.EPISODE_NAME) && series.episode.name) {
        templatedFileName = templatedFileName.replace(TemplateField.EPISODE_NAME, sanitize(series.episode.name));
    }

    // ── New inline template fields with fieldConfig support ──────────
    if (templatedFileName.includes(TemplateField.VIDEO_CODEC)) {
        templatedFileName = templatedFileName.replace(TemplateField.VIDEO_CODEC, resolveField(TemplateField.VIDEO_CODEC, resolveVideoCodecTag(videoStream), fieldConfig));
    }
    if (templatedFileName.includes(TemplateField.AUDIO_CODEC)) {
        templatedFileName = templatedFileName.replace(TemplateField.AUDIO_CODEC, resolveField(TemplateField.AUDIO_CODEC, resolveAudioCodecTag(audioStreams), fieldConfig));
    }
    if (templatedFileName.includes(TemplateField.VIDEO_HEIGHT)) {
        templatedFileName = templatedFileName.replace(TemplateField.VIDEO_HEIGHT, resolveField(TemplateField.VIDEO_HEIGHT, resolveVideoHeightTag(videoStream), fieldConfig));
    }
    if (templatedFileName.includes(TemplateField.DUAL_AUDIO)) {
        templatedFileName = templatedFileName.replace(TemplateField.DUAL_AUDIO, resolveField(TemplateField.DUAL_AUDIO, resolveDualAudioTag(audioStreams), fieldConfig));
    }

    // Strip any remaining unreplaced template tokens (e.g. {{EPISODE_NAME}} when no name available)
    // Also clean up surrounding " - " or " " artifacts from removed tokens
    templatedFileName = templatedFileName.replace(/\s*\{\{[A-Z_]+\}\}\s*/g, ' ').trim();
    templatedFileName = templatedFileName.replace(/\s{2,}/g, ' ');

    // ── Legacy tagOptions append (kept for backward compat) ─────
    if (tagOptions && Object.keys(tagOptions).length > 0) {
        const tags: string[] = [];

        if (tagOptions.languageList) {
            if (tagOptions.languageList.override !== undefined) {
                tags.push(tagOptions.languageList.override);
            } else {
                const languageSet = new Set(
                    subtitleStreams
                        .map(stream => stream.metadata?.get('language', AV_DICT_MATCH_CASE))
                        .filter(language => !!language),
                );
                if (languageSet.size > 2) {
                    tags.push(`(${Array.from(languageSet).join(',')})`);
                }
            }
        }
        if (tagOptions.height) {
            if ('fieldType' in tagOptions.height) {
                if (videoStream) {
                    tags.push(`[${tagOptions.height.override !== undefined ? tagOptions.height.override : videoStream.codecpar.height}${tagOptions.height.fieldType === 'Progressive' ? 'p' : 'i'}]`);
                }
            } else {
                tags.push(tagOptions.height.override);
            }
        }
        if (tagOptions.videoCodec) {
            if (tagOptions.videoCodec.override !== undefined) {
                tags.push(tagOptions.videoCodec.override);
            } else if (videoStream) {
                tags.push(`[${resolveVideoCodecTag(videoStream)}]`);
            }
        }
        if (tagOptions.audioCodec) {
            if (tagOptions.audioCodec.override !== undefined) {
                tags.push(tagOptions.audioCodec.override);
            } else if (audioStreams.length) {
                tags.push(`[${resolveAudioCodecTag(audioStreams)}]`);
            }
        }
        if (tagOptions.dualAudio) {
            if (tagOptions.dualAudio.override !== undefined) {
                tags.push(tagOptions.dualAudio.override);
            } else if (audioStreams.length) {
                const languageSet = new Set(audioStreams.map(stream => stream.metadata?.get('language', AV_DICT_MATCH_CASE)).filter(language => !!language));
                if (languageSet.size === 2) {
                    tags.push('[Dual Audio]');
                } else if (languageSet.size > 2) {
                    tags.push('[Multi Audio]');
                }
            }
        }

        if (tags.length > 0) {
            templatedFileName += ` ${tags.join('')}`;
        }
    }

    return templatedFileName;
}

/**
 * Resolve a template field value with prefix/suffix/always-add handling.
 * When `fieldConfig` is provided for the tag:
 *   - If the resolved value is truthy OR `alwaysAdd` is true →
 *       prefix + value + suffix  (value may be empty string when alwaysAdd)
 *   - Otherwise → '' (omit entirely)
 * When `fieldConfig` has no entry for the tag → returns value directly (legacy).
 */
function resolveField(
    tag: string,
    value: string,
    fieldConfig?: Record<string, FieldConfig>,
): string {
    const cfg = fieldConfig?.[tag];
    if (!cfg) return value; // No config → legacy behavior
    if (value || cfg.alwaysAdd) {
        return `${cfg.prefix}${value}${cfg.suffix}`;
    }
    return '';
}
