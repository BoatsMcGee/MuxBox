/**
 * Single source of truth for template field color mappings.
 * Used by both the RenameTemplateModal (contenteditable needs inline styles)
 * and ProjectView (regular DOM uses Tailwind classes).
 */

/** Tailwind color classes for field name labels (light/dark mode). */
export const FIELD_CLASS_MAP: Record<string, string> = {
    '{{SERIES_NAME}}': 'text-emerald-600 dark:text-emerald-400',
    '{{SEASON_NUMBER}}': 'text-green-600 dark:text-green-400',
    '{{EPISODE_NUMBER}}': 'text-green-500 dark:text-green-300',
    '{{EPISODE_NAME}}': 'text-lime-600 dark:text-lime-400',
    '{{VIDEO_CODEC}}': 'text-blue-600 dark:text-blue-400',
    '{{AUDIO_CODEC}}': 'text-indigo-600 dark:text-indigo-400',
    '{{VIDEO_HEIGHT}}': 'text-violet-600 dark:text-violet-400',
    '{{DUAL_AUDIO}}': 'text-cyan-600 dark:text-cyan-400',
};

/** Hex color values matching the Tailwind `*-600` scale — used in contenteditable inline styles. */
export const FIELD_HEX_MAP: Record<string, string> = {
    '{{SERIES_NAME}}': '#059669',
    '{{SEASON_NUMBER}}': '#16a34a',
    '{{EPISODE_NUMBER}}': '#22c55e',
    '{{EPISODE_NAME}}': '#65a30d',
    '{{VIDEO_CODEC}}': '#2563eb',
    '{{AUDIO_CODEC}}': '#4f46e5',
    '{{VIDEO_HEIGHT}}': '#7c3aed',
    '{{DUAL_AUDIO}}': '#0891b2',
};
