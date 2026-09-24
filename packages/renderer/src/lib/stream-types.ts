/**
 * Unified stream type system — icons, colors, labels, and helpers.
 * Single source of truth for video/audio/subtitle/attachment/chapters display constants.
 */

export type StreamType = 'video' | 'audio' | 'subtitle' | 'attachment' | 'chapters';

export interface StreamTypeCount {
  /** Total number of streams of this type in the source file. */
  total: number;
  /** Number of matched streams (for matched variant). */
  matched?: number;
  /** Number of chapters (for chapters type). */
  chapters?: number;
  /** Whether chapters will be copied (for chapters type). */
  chaptersEnabled?: boolean;
}

export type StreamTypeBadgeVariant = 'icon-badge' | 'matched' | 'total' | 'icon-only';

export interface StreamTypeInfo {
  label: string;
  /** Full color class string for pill badges (bg + text). */
  color: string;
  /** Text/icon color classes for Lucide stroke icons (icon-badge variant). */
  textColor: string;
  hoverRing: string;
  ariaLabel: string;
}

export const STREAM_TYPE_INFO: Record<StreamType, StreamTypeInfo> = {
    video: {
        label: 'Video',
        color: 'bg-blue-100 text-black dark:bg-blue-900 dark:text-white',
        textColor: 'text-blue-700 dark:text-blue-300',
        hoverRing: 'hover:ring-blue-400',
        ariaLabel: 'Video stream',
    },
    audio: {
        label: 'Audio',
        color: 'bg-green-100 text-black dark:bg-green-900 dark:text-white',
        textColor: 'text-green-700 dark:text-green-300',
        hoverRing: 'hover:ring-green-400',
        ariaLabel: 'Audio stream',
    },
    subtitle: {
        label: 'Subtitle',
        color: 'bg-purple-100 text-black dark:bg-purple-900 dark:text-white',
        textColor: 'text-purple-700 dark:text-purple-300',
        hoverRing: 'hover:ring-purple-400',
        ariaLabel: 'Subtitle stream',
    },
    attachment: {
        label: 'Attachment',
        color: 'bg-orange-100 text-black dark:bg-orange-900 dark:text-white',
        textColor: 'text-orange-700 dark:text-orange-300',
        hoverRing: 'hover:ring-orange-400',
        ariaLabel: 'Attachment',
    },
    chapters: {
        label: 'Chapters',
        color: 'bg-cyan-100 text-black dark:bg-cyan-900 dark:text-white',
        textColor: 'text-cyan-700 dark:text-cyan-300',
        hoverRing: 'hover:ring-cyan-400',
        ariaLabel: 'Chapters',
    },
};

/** Convenience type for a record of counts by stream type. */
export type StreamTypeCounts = Record<StreamType, StreamTypeCount>;

/** All stream types in display order. */
export const STREAM_TYPES: readonly StreamType[] = Object.freeze(['video', 'audio', 'subtitle', 'attachment', 'chapters']);

/** Stream types excluding chapters (for stream-only operations). */
export const STREAM_TYPES_NO_CHAPTERS: readonly StreamType[] = Object.freeze(['video', 'audio', 'subtitle', 'attachment']);

/** Static icon names for each stream type (resolve to Lucide components at use site). */
export const ICON_NAMES: Record<StreamType, string> = {
    video: 'Video',
    audio: 'Volume2',
    subtitle: 'MessageSquareText',
    attachment: 'Paperclip',
    chapters: 'BookOpen',
};

/**
 * Build per-type stream counts from an array of tracks with type + matched fields.
 * Used by StreamMatchPreview to compute N/M badges.
 */
export function computeStreamTypeCounts(
    tracks: Array<{ type: 'video' | 'audio' | 'subtitle' | 'attachment'; matched: boolean }>,
): StreamTypeCounts {
    const counts: StreamTypeCounts = {
        video: { total: 0, matched: 0 },
        audio: { total: 0, matched: 0 },
        subtitle: { total: 0, matched: 0 },
        attachment: { total: 0, matched: 0 },
        chapters: { total: 0, chapters: 0 },
    };
    for (const t of tracks) {
        counts[t.type].total++;
        if (t.matched) {
      counts[t.type].matched!++;
        }
    }
    return counts;
}

/**
 * Build badge counts including chapters for EpisodeQueueItem.
 */
export function buildBadgeCounts(
    streamCounts: { video: number; audio: number; subtitle: number; attachment: number },
    chaptersCount: number,
    chaptersEnabled: boolean,
    matchedCounts?: Record<string, number>,
): StreamTypeCounts {
    return {
        video: { total: streamCounts.video, matched: matchedCounts?.video ?? 0 },
        audio: { total: streamCounts.audio, matched: matchedCounts?.audio ?? 0 },
        subtitle: { total: streamCounts.subtitle, matched: matchedCounts?.subtitle ?? 0 },
        attachment: { total: streamCounts.attachment, matched: matchedCounts?.attachment ?? 0 },
        chapters: { total: chaptersCount, chapters: chaptersCount, chaptersEnabled },
    };
}

/**
 * Build a tooltip string for a stream type badge.
 */
export function getStreamTypeTooltip(
    type: StreamType,
    count: StreamTypeCount,
    variant: StreamTypeBadgeVariant,
): string {
    const info = STREAM_TYPE_INFO[type];
    if (type === 'chapters') {
        const total = count.chapters ?? count.total;
        if (total === 0) return 'No chapters';
        const enabled = count.chaptersEnabled ?? false;
        const status = enabled ? 'enabled' : 'disabled';
        return `Chapters: ${total} entr${total !== 1 ? 'ies' : 'y'} (${status})`;
    }
    if (variant === 'matched' && count.matched != null) {
        return `${info.label}: ${count.matched}/${count.total} matched`;
    }
    return `${info.label}: ${count.total} stream${count.total !== 1 ? 's' : ''}`;
}
