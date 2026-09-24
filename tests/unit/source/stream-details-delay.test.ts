import { describe, it, expect, vi } from 'vitest';

// getStreamDetails → stream-match.ts (getCodecEntryList) → @app/preload.
// In the node test env the preload browser build reads from globalThis,
// which is undefined — stub the bridge so codec-map init resolves.
vi.mock('@app/preload', () => ({
    getCodecEntryList: vi.fn(async () => []),
}));

import { getStreamDetails } from '@/components/source/composables/useStreamMatchPreview';
import type { StreamInfo } from '@app/preload';

function makeStreamInfo(codecType: number, extra?: Record<string, unknown>): StreamInfo {
    return {
        index: 1,
        codecType,
        codecId: 0,
        codecName: 'aac',
        metadata: {},
        dispositions: [],
        extra,
    } as StreamInfo;
}

describe('getStreamDetails delay rows', () => {
    it('shows a Delay row for audio tracks with modify.delay', () => {
        const details = getStreamDetails(
            makeStreamInfo(1),
            { delay: 1000 },
            undefined,
            'ep01.mkv',
            1,
            {},
        );
        const delayRow = details.find(d => d.label === 'Delay (ms)');
        expect(delayRow).toBeDefined();
        expect(delayRow?.changed).toBe(true);
        expect(delayRow?.after).toBe('1000');
        expect(delayRow?.overridable).toBe(true);
    });

    it('shows a Delay row for subtitle tracks with modify.delay (mirrors audio)', () => {
        const details = getStreamDetails(
            makeStreamInfo(3),
            { delay: -250 },
            undefined,
            'ep01.mkv',
            1,
            {},
        );
        const delayRow = details.find(d => d.label === 'Delay (ms)');
        expect(delayRow).toBeDefined();
        expect(delayRow?.changed).toBe(true);
        expect(delayRow?.after).toBe('-250');
        expect(delayRow?.overridable).toBe(true);
    });

    it('per-track override delay wins over modify.delay for subtitle', () => {
        const details = getStreamDetails(
            makeStreamInfo(3),
            { delay: 1000 },
            undefined,
            'ep01.mkv',
            1,
            { 'ep01.mkv': { 1: { delay: 500 } } },
        );
        const delayRow = details.find(d => d.label === 'Delay (ms)');
        expect(delayRow).toBeDefined();
        expect(delayRow?.after).toBe('500');
        expect(delayRow?.overridden).toBe(true);
    });

    it('shows inherent MediaInfo Delay when no modify/override is set (subtitle)', () => {
        const details = getStreamDetails(
            makeStreamInfo(3, { Delay: 80 }),
            undefined,
            undefined,
            'ep01.mkv',
            1,
            {},
        );
        const delayRow = details.find(d => d.label === 'Delay (ms)');
        expect(delayRow).toBeDefined();
        expect(delayRow?.changed).toBeUndefined();
        expect(delayRow?.value).toBe('80');
    });

    it('omits the Delay row when no delay is configured and no inherent delay exists', () => {
        const details = getStreamDetails(
            makeStreamInfo(3),
            undefined,
            undefined,
            'ep01.mkv',
            1,
            {},
        );
        expect(details.find(d => d.label === 'Delay (ms)')).toBeUndefined();
    });
});