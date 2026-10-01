import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { buildEpisodeModel } from '@app/muxer';
import { applyOverridesToModel } from '@app/muxer/src/episode/simulator.js';
import { buildMkvmergeChaptersArgs } from '@app/mkvtoolnix';
import type { Episode, StreamInfo, MuxerModel } from '@app/muxer';

function makeStreamInfo(index: number, codecType: number, codecName: string): StreamInfo {
    return { index, codecType, codecId: 0, codecName, metadata: {}, dispositions: [] } as StreamInfo;
}

const FILE_PATH = path.resolve('/src', 'ep01.mkv');

function makeEpisode(subtitleModify: Record<string, unknown>): Episode {
    return {
        file: { directory: '/src', name: 'ep01.mkv' },
        series: { name: 'S', season: { number: 1 }, episode: { number: 1 } },
        method: {},
        sources: [{
            file: { directory: '/src', name: 'ep01.mkv' },
            video: [], audio: [], attachment: [],
            subtitle: [{ match: { index: { equal: 2 } }, modify: subtitleModify }],
        }],
    } as Episode;
}

function streamInfoMap(): Map<string, StreamInfo[]> {
    return new Map([[FILE_PATH, [makeStreamInfo(2, 3, 'subrip')]]]);
}

/**
 * Collect the subtitle track IDs the muxer would hand to mkvmerge, mirroring
 * `EpisodeMuxer.compressibleSubtitleTrackIds`.
 */
function compressibleIds(model: MuxerModel): number[] {
    return model.comparisons
        .filter(c => c.codecType === 'subtitle' && (c.muxCompress ?? true))
        .map(c => c.outputIndex);
}

/**
 * End-to-end over the pure-data path: queue override → model → mkvmerge args.
 *
 * This asserts that a queue-level toggle actually changes what mkvmerge is asked
 * to do, rather than only changing the displayed state.
 */
describe('queue compress override → mkvmerge args', () => {
    it('emits --compression by default', () => {
        const model = buildEpisodeModel(makeEpisode({}), streamInfoMap());
        const args = buildMkvmergeChaptersArgs('/out/ep.mkv', [], compressibleIds(model));
        expect(args).toContain('--compression');
    });

    it('emits no --compression when a queue override disables it', () => {
        const model = buildEpisodeModel(makeEpisode({}), streamInfoMap());
        const overridden = applyOverridesToModel(model, {
            [`${FILE_PATH}:2`]: { compress: false },
        });
        const args = buildMkvmergeChaptersArgs('/out/ep.mkv', [], compressibleIds(overridden));
        expect(args).not.toContain('--compression');
    });

    it('restores compression once the override is gone (undo/reset)', () => {
        const model = buildEpisodeModel(makeEpisode({}), streamInfoMap());
        const overridden = applyOverridesToModel(model, {
            [`${FILE_PATH}:2`]: { compress: false },
        });
        expect(compressibleIds(overridden)).toEqual([]);

        // The queue rebuilds from a fresh model when the override is cleared.
        const fresh = buildEpisodeModel(makeEpisode({}), streamInfoMap());
        expect(compressibleIds(fresh)).toEqual([0]);
    });

    it('honours a source-level compress:false', () => {
        const model = buildEpisodeModel(makeEpisode({ compress: false }), streamInfoMap());
        expect(compressibleIds(model)).toEqual([]);
    });

    it('lets a queue override re-enable compression over a source-level false', () => {
        const model = buildEpisodeModel(makeEpisode({ compress: false }), streamInfoMap());
        const overridden = applyOverridesToModel(model, {
            [`${FILE_PATH}:2`]: { compress: true },
        });
        expect(compressibleIds(overridden)).toEqual([0]);
    });
});
