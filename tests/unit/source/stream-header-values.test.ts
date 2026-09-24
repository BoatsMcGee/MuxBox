import { describe, it, expect, vi } from 'vitest';

// getTrackHeaderValues → stream-match.ts (getCodecEntryList) → @app/preload.
// In the node test env the preload browser build reads from globalThis,
// which is undefined — stub the bridge so codec-map init resolves.
vi.mock('@app/preload', () => ({
    getCodecEntryList: vi.fn(async () => []),
}));

import { getTrackHeaderValues } from '@/components/source/composables/useStreamMatchPreview';
import type { MatchedTrack } from '@/lib/stream-match';
import type { StreamInfo } from '@app/preload';

function makeTrack(overrides: Partial<MatchedTrack> = {}): MatchedTrack {
    const streamInfo: StreamInfo = {
        index: 1,
        codecType: 1,
        codecId: 0,
        codecName: 'aac',
        metadata: {},
        dispositions: [],
    } as StreamInfo;
    return {
        index: 1,
        type: 'audio',
        codec: 'aac',
        language: '—',
        title: '',
        matched: true,
        streamInfo,
        ...overrides,
    };
}

describe('getTrackHeaderValues', () => {
    it('returns original values unchanged when no modify/override is set', () => {
        const track = makeTrack({
            codec: 'aac',
            language: 'eng',
            title: 'English',
            streamInfo: {
                index: 1,
                codecType: 1,
                codecId: 0,
                codecName: 'aac',
                metadata: { language: 'eng', title: 'English' },
                dispositions: [],
            } as StreamInfo,
        });
        const values = getTrackHeaderValues(track, 'ep01.mkv', {});
        expect(values.codec).toBe('aac');
        expect(values.language).toBe('eng');
        expect(values.title).toBe('English');
        expect(values.codecChanged).toBe(false);
        expect(values.languageChanged).toBe(false);
        expect(values.titleChanged).toBe(false);
    });

    it('reflects modify.title and modify.language as changed', () => {
        const track = makeTrack({
            codec: 'aac',
            language: 'eng',
            title: 'English',
            streamInfo: {
                index: 1,
                codecType: 1,
                codecId: 0,
                codecName: 'aac',
                metadata: { language: 'eng', title: 'English' },
                dispositions: [],
            } as StreamInfo,
            modify: { title: 'English Dub', language: 'jpn' },
        });
        const values = getTrackHeaderValues(track, 'ep01.mkv', {});
        expect(values.title).toBe('English Dub');
        expect(values.titleChanged).toBe(true);
        expect(values.language).toBe('jpn');
        expect(values.languageChanged).toBe(true);
        expect(values.codecChanged).toBe(false);
    });

    it('per-track override wins over modify config', () => {
        const track = makeTrack({
            codec: 'aac',
            language: 'eng',
            title: 'English',
            streamInfo: {
                index: 1,
                codecType: 1,
                codecId: 0,
                codecName: 'aac',
                metadata: { language: 'eng', title: 'English' },
                dispositions: [],
            } as StreamInfo,
            modify: { title: 'English Dub', language: 'jpn' },
        });
        const values = getTrackHeaderValues(track, 'ep01.mkv', {
            'ep01.mkv': { 1: { title: 'Override Title', language: 'ger' } },
        });
        expect(values.title).toBe('Override Title');
        expect(values.titleChanged).toBe(true);
        expect(values.language).toBe('ger');
        expect(values.languageChanged).toBe(true);
    });

    it('opusenc preprocess reports codec OPUS as changed', () => {
        const track = makeTrack({
            codec: 'aac',
            streamInfo: {
                index: 1,
                codecType: 1,
                codecId: 0,
                codecName: 'aac',
                metadata: {},
                dispositions: [],
            } as StreamInfo,
            preprocess: { opusenc: { bitrate: 128 } },
        });
        const values = getTrackHeaderValues(track, 'ep01.mkv', {});
        expect(values.codec).toBe('OPUS');
        expect(values.codecChanged).toBe(true);
    });

    it('empty modify title is treated as a change to empty (matches getStreamDetails)', () => {
        const track = makeTrack({
            codec: 'aac',
            language: 'eng',
            title: 'English',
            streamInfo: {
                index: 1,
                codecType: 1,
                codecId: 0,
                codecName: 'aac',
                metadata: { language: 'eng', title: 'English' },
                dispositions: [],
            } as StreamInfo,
            modify: { title: '' },
        });
        const values = getTrackHeaderValues(track, 'ep01.mkv', {});
        expect(values.title).toBe('');
        expect(values.titleChanged).toBe(true);
    });
});