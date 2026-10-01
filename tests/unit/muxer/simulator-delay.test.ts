import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { buildEpisodeModel } from '@app/muxer';
import { applyOverridesToModel } from '@app/muxer/src/episode/simulator.js';
import type { Episode, StreamInfo } from '@app/muxer';

/**
 * Build a minimal StreamInfo for the simulator.
 * codecType: 0=video, 1=audio, 3=subtitle (AVMEDIA_TYPE_*).
 */
function makeStreamInfo(index: number, codecType: number, codecName: string): StreamInfo {
    return {
        index,
        codecType,
        codecId: 0,
        codecName,
        metadata: {},
        dispositions: [],
    } as StreamInfo;
}

/** The resolved file path used as the demuxerMapKey (mirrors buildEpisodeModel). */
const FILE_PATH = path.resolve('/src', 'ep01.mkv');

function makeEpisode(overrides: Partial<Episode['sources'][0]> = {}): Episode {
    return {
        file: { directory: '/src', name: 'ep01.mkv' },
        series: { name: 'Series', season: { number: 1 }, episode: { number: 1 } },
        method: {},
        sources: [
            {
                file: { directory: '/src', name: 'ep01.mkv' },
                video: [],
                audio: [],
                subtitle: [],
                attachment: [],
                ...overrides,
            },
        ],
    } as Episode;
}

describe('buildEpisodeModel delay propagation', () => {
    it('carries rule-level modify.delay into comparisons (audio)', () => {
        const episode = makeEpisode({
            audio: [
                {
                    match: { index: { equal: 1 } },
                    modify: { delay: 1000 },
                },
            ],
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(1, 1, 'aac')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        const audio = model.comparisons.find(c => c.codecType === 'audio');
        expect(audio).toBeDefined();
        expect(audio?.muxedDelay).toBe(1000);
    });

    it('carries rule-level modify.delay into comparisons (subtitle)', () => {
        const episode = makeEpisode({
            subtitle: [
                {
                    match: { index: { equal: 2 } },
                    modify: { delay: -250 },
                },
            ],
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(2, 3, 'subrip')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        const sub = model.comparisons.find(c => c.codecType === 'subtitle');
        expect(sub).toBeDefined();
        expect(sub?.muxedDelay).toBe(-250);
    });

    it('per-track modifier delay wins over rule-level modify.delay', () => {
        const episode = makeEpisode({
            audio: [
                {
                    match: { index: { equal: 1 } },
                    modify: { delay: 1000 },
                },
            ],
            perTrackModifiers: {
                1: { delay: 2000 },
            },
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(1, 1, 'aac')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        const audio = model.comparisons.find(c => c.codecType === 'audio');
        expect(audio?.muxedDelay).toBe(2000);
    });

    it('defaults muxedDelay to 0 when no delay is configured', () => {
        const episode = makeEpisode({
            audio: [{ match: { index: { equal: 1 } } }],
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(1, 1, 'aac')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        const audio = model.comparisons.find(c => c.codecType === 'audio');
        expect(audio?.muxedDelay).toBe(0);
    });

    it('queue override delay updates muxedDelay via applyOverridesToModel', () => {
        const episode = makeEpisode({
            audio: [
                {
                    match: { index: { equal: 1 } },
                    modify: { delay: 1000 },
                },
            ],
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(1, 1, 'aac')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        const overridden = applyOverridesToModel(model, {
            [`${FILE_PATH}:1`]: { delay: 500 },
        });
        const audio = overridden.comparisons.find(c => c.codecType === 'audio');
        expect(audio?.muxedDelay).toBe(500);
    });
});

describe('applyOverridesToModel preserves unrelated fields', () => {
    /**
             * Regression guards. The previous implementation rebuilt comparisons via an
             * intermediate SimulatedStream that set `modify: undefined`, which silently
             * reset muxedDelay to 0 and dropped muxCompress back to the default.
             */
    it('does not reset muxedDelay for tracks without a delay override', () => {
        const episode = makeEpisode({
            audio: [{ match: { index: { equal: 1 } }, modify: { delay: 1000 } }],
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(1, 1, 'aac')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        const overridden = applyOverridesToModel(model, {
            // Override a *different* track entirely.
            [`${FILE_PATH}:99`]: { title: 'Unrelated' },
        });
        const audio = overridden.comparisons.find(c => c.codecType === 'audio');
        expect(audio?.muxedDelay).toBe(1000);
    });

    it('preserves muxCompress when an unrelated override is applied', () => {
        const episode = makeEpisode({
            subtitle: [{ match: { index: { equal: 2 } }, modify: { compress: false } }],
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(2, 3, 'subrip')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        const overridden = applyOverridesToModel(model, {
            [`${FILE_PATH}:2`]: { title: 'Renamed' },
        });
        const sub = overridden.comparisons.find(c => c.codecType === 'subtitle');
        expect(sub?.muxCompress).toBe(false);
    });

    it('applies a queue-level compress override', () => {
        const episode = makeEpisode({
            subtitle: [{ match: { index: { equal: 2 } }, modify: { compress: true } }],
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(2, 3, 'subrip')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        const overridden = applyOverridesToModel(model, {
            [`${FILE_PATH}:2`]: { compress: false },
        });
        const sub = overridden.comparisons.find(c => c.codecType === 'subtitle');
        expect(sub?.muxCompress).toBe(false);
    });

    it('ignores a compress override on non-subtitle tracks', () => {
        const episode = makeEpisode({
            audio: [{ match: { index: { equal: 1 } } }],
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(1, 1, 'aac')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        const overridden = applyOverridesToModel(model, {
            [`${FILE_PATH}:1`]: { compress: false },
        });
        const audio = overridden.comparisons.find(c => c.codecType === 'audio');
        expect(audio?.muxCompress).toBeUndefined();
    });

    it('preserves muxedDispositions names when translating an override', () => {
        const episode = makeEpisode({
            video: [{ match: { index: { equal: 0 } }, modify: { disposition: { 1: true } } }],
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(0, 0, 'h264')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        const overridden = applyOverridesToModel(model, {
            // AV_DISPOSITION_FORCED = 64 → "Forced"
            [`${FILE_PATH}:0`]: { disposition: { 64: true } },
        });
        const video = overridden.comparisons.find(c => c.codecType === 'video');
        expect(video?.muxedDispositions).toEqual(expect.arrayContaining(['Default', 'Forced']));
    });

    it('removes a disposition when overridden to false', () => {
        const episode = makeEpisode({
            video: [{ match: { index: { equal: 0 } }, modify: { disposition: { 64: true } } }],
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(0, 0, 'h264')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        const overridden = applyOverridesToModel(model, {
            [`${FILE_PATH}:0`]: { disposition: { 64: false } },
        });
        const video = overridden.comparisons.find(c => c.codecType === 'video');
        expect(video?.muxedDispositions).not.toContain('Forced');
    });

    it('returns the model untouched when overrides are undefined', () => {
        const episode = makeEpisode({
            subtitle: [{ match: { index: { equal: 2 } }, modify: { compress: false } }],
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(2, 3, 'subrip')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        expect(applyOverridesToModel(model, undefined)).toBe(model);
    });
});