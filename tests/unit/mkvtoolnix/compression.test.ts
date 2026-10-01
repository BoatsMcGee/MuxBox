import { describe, it, expect } from 'vitest';
import {
    isTextBasedSubtitleTrack,
    getCompressibleSubtitleTrackIds,
} from '@app/mkvtoolnix';
import type { TrackInfo } from '@app/mkvtoolnix';

/** Build a minimal mkvmerge -J track entry. */
function track(over: Partial<TrackInfo> & { properties?: Record<string, unknown> }): TrackInfo {
    return {
        codec: over.codec,
        id: over.id,
        type: over.type,
        properties: over.properties as TrackInfo['properties'],
    };
}

describe('isTextBasedSubtitleTrack', () => {
    it('trusts mkvmerge text_subtitles when present', () => {
        expect(isTextBasedSubtitleTrack(track({ properties: { text_subtitles: true } }))).toBe(true);
        expect(isTextBasedSubtitleTrack(track({ properties: { text_subtitles: false } }))).toBe(false);
    });

    it('falls back to codec_id when text_subtitles is absent', () => {
        for (const codecId of ['S_TEXT/UTF8', 'S_TEXT/ASS', 'S_TEXT/SSA', 'S_TEXT/ASCII', 'S_TEXT/USF', 'S_TEXT/WEBVTT']) {
            expect(isTextBasedSubtitleTrack(track({ properties: { codec_id: codecId } }))).toBe(true);
        }
    });

    it('rejects bitmap subtitle codecs by codec_id', () => {
        for (const codecId of ['S_HDMV/PGS', 'S_VOBSUB', 'S_DVBSUB', 'S_HDMV/TEXT']) {
            expect(isTextBasedSubtitleTrack(track({ properties: { codec_id: codecId } }))).toBe(false);
        }
    });

    it('falls back to the human-readable codec name', () => {
        expect(isTextBasedSubtitleTrack(track({ codec: 'SubRip/SRT' }))).toBe(true);
        expect(isTextBasedSubtitleTrack(track({ codec: 'SubStationAlpha' }))).toBe(true);
        expect(isTextBasedSubtitleTrack(track({ codec: 'WebVTT' }))).toBe(true);
        expect(isTextBasedSubtitleTrack(track({ codec: 'HDMV PGS' }))).toBe(false);
    });

    it('is conservative when nothing identifies the codec', () => {
        expect(isTextBasedSubtitleTrack(track({}))).toBe(false);
        expect(isTextBasedSubtitleTrack(track({ codec: 'Something Unknown' }))).toBe(false);
    });
});

describe('getCompressibleSubtitleTrackIds', () => {
    const mixed: TrackInfo[] = [
        track({ id: 0, type: 'video', properties: { codec_id: 'V_MPEG4/ISO/AVC' } }),
        track({ id: 1, type: 'subtitles', properties: { codec_id: 'S_TEXT/UTF8' } }),
        track({ id: 2, type: 'audio', properties: { codec_id: 'A_AAC' } }),
        track({ id: 3, type: 'subtitles', properties: { codec_id: 'S_HDMV/PGS' } }),
        track({ id: 4, type: 'subtitles', properties: { codec_id: 'S_TEXT/ASS' } }),
    ];

    it('returns only text-based subtitle track ids, sorted ascending', () => {
        expect(getCompressibleSubtitleTrackIds(mixed)).toEqual([1, 4]);
    });

    it('never returns non-subtitle track ids', () => {
        const ids = getCompressibleSubtitleTrackIds(mixed);
        expect(ids).not.toContain(0);
        expect(ids).not.toContain(2);
    });

    it('honours a restrictTo set of track indices', () => {
        expect(getCompressibleSubtitleTrackIds(mixed, new Set([4]))).toEqual([4]);
        expect(getCompressibleSubtitleTrackIds(mixed, new Set([3]))).toEqual([]);
        expect(getCompressibleSubtitleTrackIds(mixed, new Set([1, 4]))).toEqual([1, 4]);
    });

    it('returns an empty array for undefined or empty input', () => {
        expect(getCompressibleSubtitleTrackIds(undefined)).toEqual([]);
        expect(getCompressibleSubtitleTrackIds([])).toEqual([]);
    });

    it('skips tracks with no id', () => {
        const tracks = [track({ type: 'subtitles', properties: { codec_id: 'S_TEXT/UTF8' } })];
        expect(getCompressibleSubtitleTrackIds(tracks)).toEqual([]);
    });
});
