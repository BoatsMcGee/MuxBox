/**
 * Shared template field constants, types, and helpers.
 * Single source of truth for the renderer — imported by both the preview
 * function in stream-match.ts and the RenameTemplateModal.
 */

export const TEMPLATE_FIELDS = {
    SERIES_NAME: '{{SERIES_NAME}}',
    SEASON_NUMBER: '{{SEASON_NUMBER}}',
    EPISODE_NUMBER: '{{EPISODE_NUMBER}}',
    EPISODE_NAME: '{{EPISODE_NAME}}',
    VIDEO_CODEC: '{{VIDEO_CODEC}}',
    AUDIO_CODEC: '{{AUDIO_CODEC}}',
    VIDEO_HEIGHT: '{{VIDEO_HEIGHT}}',
    DUAL_AUDIO: '{{DUAL_AUDIO}}',
} as const;

export type TemplateField = typeof TEMPLATE_FIELDS[keyof typeof TEMPLATE_FIELDS];

/** Human-readable labels for template fields, used in UI hints. */
export const TEMPLATE_FIELD_LABELS: Record<string, string> = {
    '{{SERIES_NAME}}': 'Series Name',
    '{{SEASON_NUMBER}}': 'Season Number',
    '{{EPISODE_NUMBER}}': 'Episode Number',
    '{{EPISODE_NAME}}': 'Episode Name',
    '{{VIDEO_CODEC}}': 'Video Codec (e.g. AVC, HEVC, AV1)',
    '{{AUDIO_CODEC}}': 'Audio Codec (e.g. FLAC, AAC, AC3)',
    '{{VIDEO_HEIGHT}}': 'Video Height (e.g. 1080p, 720p)',
    '{{DUAL_AUDIO}}': 'Dual/Multi Audio Tag',
};

/** Per-field prefix/suffix/always-add/padding configuration for rename template fields. */
export interface FieldConfig {
    prefix: string;
    suffix: string;
    alwaysAdd: boolean;
    /** Minimum zero-padding for numeric fields (season/episode numbers). Default 2. */
    padding?: number;
}

/**
 * Resolve a template field value with prefix/suffix/always-add handling.
 * When `fieldConfig` is provided for the tag:
 *   - If the resolved value is truthy OR `alwaysAdd` is true →
 *       prefix + value + suffix  (value may be empty string when alwaysAdd)
 *   - Otherwise → '' (omit entirely)
 * When `fieldConfig` has no entry for the tag → returns value directly (legacy).
 */
export function resolveField(
    tag: string,
    value: string,
    fieldConfig?: Record<string, FieldConfig>,
): string {
    const cfg = fieldConfig?.[tag];
    if (!cfg) return value;
    if (value || cfg.alwaysAdd) {
        return `${cfg.prefix}${value}${cfg.suffix}`;
    }
    return '';
}
