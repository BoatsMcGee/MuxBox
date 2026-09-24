import { describe, it, expect } from 'vitest';
import {
    getEffectiveChapterDelay,
    parseChapterTimestampToMs,
    formatChapterTimestamp,
    shiftChapterTimestamp,
    getParsedChapters,
} from '@/components/source/composables/useStreamMatchPreview';
import type { FilePreviewState } from '@/components/source/types/stream-match-types';

function makeFileState(chapters: Record<string, string>): FilePreviewState {
    return {
        file: 'ep01.mkv',
        loading: false,
        error: false,
        totalStreams: 1,
        matchedStreams: 1,
        anyMatched: true,
        tracks: [
            {
                index: 0,
                type: 'video',
                codec: 'h264',
                language: 'eng',
                title: 'Video',
                matched: true,
                streamInfo: {
                    containerMeta: { _Chapters: chapters },
                },
            },
        ],
    } as unknown as FilePreviewState;
}

describe('chapter delay helpers', () => {
    it('resolves per-file delay (defaults to 0)', () => {
        expect(getEffectiveChapterDelay('a.mkv', { 'a.mkv': -250 })).toBe(-250);
        // No per-file entry → 0.
        expect(getEffectiveChapterDelay('b.mkv', { 'a.mkv': -250 })).toBe(0);
        expect(getEffectiveChapterDelay('b.mkv', undefined)).toBe(0);
    });

    it('shifts timestamps and clips negatives to zero', () => {
        expect(shiftChapterTimestamp('00:00:10.000', 500)).toBe('00:00:10.500');
        expect(shiftChapterTimestamp('00:00:10.000', -250)).toBe('00:00:09.750');
        expect(shiftChapterTimestamp('00:00:00.100', -500)).toBe('00:00:00.000');
        expect(shiftChapterTimestamp('00:00:10.000', 0)).toBe('00:00:10.000');
    });

    it('round-trips chapter timestamps through ms conversion', () => {
        expect(parseChapterTimestampToMs('01:02:03.456')).toBe(((1 * 3600 + 2 * 60 + 3) * 1000) + 456);
        expect(formatChapterTimestamp(3723456)).toBe('01:02:03.456');
        expect(parseChapterTimestampToMs('not-a-timestamp')).toBeNull();
    });

    it('applies effective delay to parsed chapters', () => {
        const state = makeFileState({ _00_00_10_000: 'en:Chapter 1' });
        const shifted = getParsedChapters(state, 1500);
        expect(shifted).toHaveLength(1);
        expect(shifted[0]?.timestamp).toBe('00:00:11.500');
        expect(shifted[0]?.originalTimestamp).toBe('00:00:10.000');

        const raw = getParsedChapters(state, 0);
        expect(raw[0]?.timestamp).toBe('00:00:10.000');
        expect(raw[0]?.originalTimestamp).toBeUndefined();
    });
});
