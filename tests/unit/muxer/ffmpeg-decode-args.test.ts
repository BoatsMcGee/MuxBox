import { describe, it, expect } from 'vitest';
import { buildFfmpegDecodeArgs } from '@app/muxer';

describe('buildFfmpegDecodeArgs', () => {
    it('places -af before output options when downmixing', () => {
        const args = buildFfmpegDecodeArgs('ep01.mkv', 2, 'pan=stereo|FL=1.0*FL|FR=1.0*FR');
        expect(args).toEqual([
            '-i', 'ep01.mkv',
            '-map', '0:2',
            '-af', 'pan=stereo|FL=1.0*FL|FR=1.0*FR',
            '-c:a', 'pcm_s16le',
            '-f', 'wav',
            '-',
        ]);
        // Regression: '-af' after '-f' makes ffmpeg report
        // "Requested output format '-af' is not known".
        expect(args.indexOf('-af')).toBeLessThan(args.indexOf('-f'));
    });

    it('omits -af when no downmix filter is given', () => {
        const args = buildFfmpegDecodeArgs('ep01.mkv', 1);
        expect(args).toEqual([
            '-i', 'ep01.mkv',
            '-map', '0:1',
            '-c:a', 'pcm_s16le',
            '-f', 'wav',
            '-',
        ]);
    });
});
