import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { buildEpisodeModel } from '@app/muxer';
import type { Episode, StreamInfo } from '@app/muxer';

/** Build a minimal StreamInfo for the simulator. codecType: 0=video, 1=audio, 3=subtitle. */
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

describe('buildEpisodeModel subtitle compression', () => {
    it('defaults muxCompress to true when nothing is configured', () => {
        const episode = makeEpisode({ subtitle: [{ match: { index: { equal: 2 } } }] });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(2, 3, 'subrip')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        const sub = model.comparisons.find(c => c.codecType === 'subtitle');
        expect(sub?.muxCompress).toBe(true);
    });

    it('carries rule-level modify.compress into comparisons', () => {
        const episode = makeEpisode({
            subtitle: [{ match: { index: { equal: 2 } }, modify: { compress: false } }],
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(2, 3, 'subrip')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        const sub = model.comparisons.find(c => c.codecType === 'subtitle');
        expect(sub?.muxCompress).toBe(false);
    });

    it('lets a per-track modifier override the rule-level value', () => {
        const episode = makeEpisode({
            subtitle: [{ match: { index: { equal: 2 } }, modify: { compress: false } }],
            perTrackModifiers: { 2: { compress: true } },
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [makeStreamInfo(2, 3, 'subrip')]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        const sub = model.comparisons.find(c => c.codecType === 'subtitle');
        expect(sub?.muxCompress).toBe(true);
    });

    it('does not set muxCompress on non-subtitle tracks', () => {
        const episode = makeEpisode({
            video: [{ match: { index: { equal: 0 } } }],
            audio: [{ match: { index: { equal: 1 } } }],
        });
        const streamInfoMap = new Map<string, StreamInfo[]>([
            [FILE_PATH, [
                makeStreamInfo(0, 0, 'h264'),
                makeStreamInfo(1, 1, 'aac'),
            ]],
        ]);

        const model = buildEpisodeModel(episode, streamInfoMap);
        for (const comp of model.comparisons) {
            expect(comp.codecType === 'subtitle' ? true : comp.muxCompress).toBe(
                comp.codecType === 'subtitle' ? true : undefined,
            );
        }
    });
});
