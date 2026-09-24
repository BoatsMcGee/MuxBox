import { describe, it, expect } from 'vitest';
import { serializeSnapshot } from '@app/muxer';

function makeMapSnapshot(): unknown {
    return {
        episodeLabel: 'S01E01',
        phase: 'muxing',
        streams: new Map([
            ['src:0', {
                streamKey: 'src:0',
                outputIndex: 0,
                codecType: 'video',
                packetsWritten: 3,
                lastDts: 90000n,
                lastPts: 90000n,
                timeBaseNum: 1,
                timeBaseDen: 90000,
                durationUs: 1000000,
                timecode: '00:00:01.000',
                percent: 10,
            }],
        ]),
        sources: new Map([
            ['src', {
                demuxerMapKey: 'src',
                sourceName: 'src',
                packetsWritten: 3,
                streams: [{
                    streamKey: 'src:0',
                    outputIndex: 0,
                    codecType: 'video',
                    packetsWritten: 3,
                    lastDts: 90000n,
                    lastPts: 90000n,
                    timeBaseNum: 1,
                    timeBaseDen: 90000,
                    durationUs: 1000000,
                    timecode: '00:00:01.000',
                    percent: 10,
                }],
                timecode: '00:00:01.000',
                percent: 10,
            }],
        ]),
        totalPacketsWritten: 3,
        totalTimecode: '00:00:01.000',
        totalPositionUs: 1000000,
        totalPercent: 10,
        totalDurationUs: 10000000,
        elapsedMs: 100,
        pps: 30,
        estimatedRemainingMs: 900,
        error: undefined,
    };
}

describe('serializeSnapshot', () => {
    it('does not throw on undefined (early failure before first progress)', () => {
        expect(() => serializeSnapshot(undefined)).not.toThrow();
        const out = serializeSnapshot(undefined);
        expect(out.streams).toEqual({});
        expect(out.sources).toEqual({});
    });

    it('does not throw on the empty-object fallback that previously crashed', () => {
        expect(() => serializeSnapshot({})).not.toThrow();
        expect(serializeSnapshot({}).streams).toEqual({});
    });

    it('converts Map fields and bigint DTS values', () => {
        const out = serializeSnapshot(makeMapSnapshot());
        expect(out.streams['src:0']).toMatchObject({ packetsWritten: 3 });
        expect((out.streams['src:0'] as { lastDts: unknown }).lastDts).toBe(90000);
        expect(typeof (out.streams['src:0'] as { lastDts: unknown }).lastDts).toBe('number');
        expect(out.sources['src']).toBeDefined();
    });

    it('accepts already-serialized plain-object snapshots', () => {
        const once = serializeSnapshot(makeMapSnapshot());
        expect(() => serializeSnapshot(once)).not.toThrow();
        const twice = serializeSnapshot(once);
        expect(twice.streams['src:0']).toBeDefined();
        expect(twice.totalPercent).toBe(10);
    });

    it('preserves the error message on error-phase snapshots', () => {
        const out = serializeSnapshot({ ...(makeMapSnapshot() as Record<string, unknown>), phase: 'error', error: 'boom' });
        expect(out.error).toBe('boom');
    });
});
