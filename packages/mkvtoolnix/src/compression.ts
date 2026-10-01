import type { TrackInfo } from './types.js';

/**
 * Matroska subtitle codec IDs that mkvmerge can meaningfully zlib-compress.
 *
 * Matroska's `ContentEncodings` element is a frame-level transform intended for
 * text-based subtitle tracks. Bitmap subtitle codecs (PGS, VoBSub, DVB, XSUB) are
 * already compressed formats, and some players reject a ContentEncoding on them,
 * so they are deliberately excluded.
 *
 * Values are the `codec_id` strings reported by `mkvmerge -J`.
 */
const TEXT_SUBTITLE_CODEC_IDS: ReadonlySet<string> = new Set([
    'S_TEXT/ASCII',
    'S_TEXT/ASS',
    'S_TEXT/SSA',
    'S_TEXT/UTF8',
    'S_TEXT/USF',
    'S_TEXT/WEBVTT',
]);

/** Human-readable `codec` names, used when `codec_id` is absent. */
const TEXT_SUBTITLE_CODEC_NAMES: ReadonlySet<string> = new Set([
    'subrip',
    'srt',
    'subrip/srt',
    'ass',
    'ssa',
    'substationalpha',
    'ssa/ass subtitles',
    'webvtt',
    'usf',
]);

/** A track as returned by `mkvmerge -J`, narrowed to the fields this module reads. */
type SubtitleTrackLike = Pick<TrackInfo, 'codec' | 'properties'>;

/**
 * Whether a subtitle track is text-based and therefore a zlib compression candidate.
 *
 * Prefers mkvmerge's own `text_subtitles` property when present, since mkvmerge is the
 * component that decides whether Matroska `ContentEncodings` applies. Falls back to a
 * codec allowlist, and is deliberately conservative: an unrecognised codec returns
 * `false` rather than risking a compression flag on a bitmap track.
 */
export function isTextBasedSubtitleTrack(track: SubtitleTrackLike): boolean {
    const props = track.properties as Record<string, unknown> | undefined;

    // Authoritative signal from mkvmerge itself.
    if (typeof props?.text_subtitles === 'boolean') {
        return props.text_subtitles;
    }

    const codecId = props?.codec_id;
    if (typeof codecId === 'string' && codecId.length > 0) {
        return TEXT_SUBTITLE_CODEC_IDS.has(codecId);
    }

    const codec = track.codec;
    if (!codec) return false;
    return TEXT_SUBTITLE_CODEC_NAMES.has(codec.trim().toLowerCase());
}

/**
 * Collect the track IDs of text-based subtitle tracks from `mkvmerge -J` output.
 *
 * Track IDs are unique within a file, so the result is safe to pass to
 * `--compression TID:zlib` as-is. mkvmerge reports `id` as a 0-based index that
 * matches the file's track order, and `number` as the 1-based Matroska TrackNumber —
 * this module uses `id`.
 *
 * @param tracks - Tracks from `mkvmerge -J`, or undefined.
 * @param restrictTo - Optional set of 0-based track indices to limit the result to.
 *   Used to honour per-track user overrides.
 * @returns Ascending-sorted track IDs, or an empty array when there are none.
 */
export function getCompressibleSubtitleTrackIds(
    tracks: readonly TrackInfo[] | undefined,
    restrictTo?: ReadonlySet<number>,
): number[] {
    const ids: number[] = [];
    for (const track of tracks ?? []) {
        if (track.id == null) continue;
        if (track.type !== 'subtitles') continue;
        if (restrictTo && !restrictTo.has(track.id)) continue;
        if (!isTextBasedSubtitleTrack(track)) continue;
        ids.push(track.id);
    }
    return ids.sort((a, b) => a - b);
}
