import { describe, it, expect } from 'vitest';
import { buildMkvmergeChaptersArgs } from '@app/mkvtoolnix';

describe('buildMkvmergeChaptersArgs', () => {
    it('places --chapter-sync BEFORE the chapters source path', () => {
        const args = buildMkvmergeChaptersArgs('out/ep01.mkv', [
            { path: 'src/ep01.mkv', delay: -1000 },
        ]);

        const syncIdx = args.indexOf('--chapter-sync');
        const srcIdx = args.indexOf('src/ep01.mkv');

        expect(syncIdx).toBeGreaterThan(-1);
        expect(srcIdx).toBeGreaterThan(-1);
        expect(syncIdx).toBeLessThan(srcIdx);
        expect(args[syncIdx + 1]).toBe('-1000');
    });

    it('applies a positive delay too', () => {
        const args = buildMkvmergeChaptersArgs('out/ep01.mkv', [
            { path: 'src/ep01.mkv', delay: 500 },
        ]);

        const syncIdx = args.indexOf('--chapter-sync');
        const srcIdx = args.indexOf('src/ep01.mkv');

        expect(syncIdx).toBeGreaterThan(-1);
        expect(syncIdx).toBeLessThan(srcIdx);
        expect(args[syncIdx + 1]).toBe('500');
    });

    it('emits no --chapter-sync when delay is 0', () => {
        const args = buildMkvmergeChaptersArgs('out/ep01.mkv', [
            { path: 'src/ep01.mkv', delay: 0 },
        ]);

        expect(args).not.toContain('--chapter-sync');
        expect(args).toContain('src/ep01.mkv');
    });

    it('emits no --chapter-sync when delay is undefined', () => {
        const args = buildMkvmergeChaptersArgs('out/ep01.mkv', [
            { path: 'src/ep01.mkv' },
        ]);

        expect(args).not.toContain('--chapter-sync');
        expect(args).toContain('src/ep01.mkv');
    });

    it('handles multiple chapters sources independently', () => {
        const args = buildMkvmergeChaptersArgs('out/ep01.mkv', [
            { path: 'src/a.mkv', delay: -1000 },
            { path: 'src/b.mkv' },
        ]);

        const firstSync = args.indexOf('--chapter-sync');
        const aIdx = args.indexOf('src/a.mkv');
        const bIdx = args.indexOf('src/b.mkv');

        expect(firstSync).toBeGreaterThan(-1);
        expect(firstSync).toBeLessThan(aIdx);
        expect(aIdx).toBeLessThan(bIdx);
        // Only one --chapter-sync for the single delayed source.
        expect(args.filter((a) => a === '--chapter-sync')).toHaveLength(1);
    });

    it('excludes all track types and tags from each chapters source', () => {
        const args = buildMkvmergeChaptersArgs('out/ep01.mkv', [
            { path: 'src/ep01.mkv', delay: -1000 },
        ]);

        const srcIdx = args.indexOf('src/ep01.mkv');
        const flags = args.slice(0, srcIdx);
        expect(flags).toEqual(
            expect.arrayContaining([
                '--no-subtitles',
                '--no-video',
                '--no-audio',
                '--no-attachments',
                '--no-track-tags',
            ]),
        );
    });
});

describe('buildMkvmergeChaptersArgs — subtitle compression', () => {
    it('places --compression BEFORE the muxed file path', () => {
        // mkvmerge applies per-track options to the *following* input file, so a
        // --compression flag emitted after the path would be silently ignored.
        const args = buildMkvmergeChaptersArgs('out/ep01.mkv', [], [2]);

        const compIdx = args.indexOf('--compression');
        const fileIdx = args.indexOf('out/ep01.mkv');

        expect(compIdx).toBeGreaterThan(-1);
        expect(fileIdx).toBeGreaterThan(-1);
        expect(compIdx).toBeLessThan(fileIdx);
    });

    it('emits one TID:zlib flag per requested track', () => {
        const args = buildMkvmergeChaptersArgs('out/ep01.mkv', [], [0, 3, 7]);

        const flags = args.filter((a) => a === '--compression');
        expect(flags).toHaveLength(3);

        const values = args
            .map((a, i) => (a === '--compression' ? args[i + 1] : undefined))
            .filter((v): v is string => v !== undefined);

        expect(values).toEqual(['0:zlib', '3:zlib', '7:zlib']);
    });

    it('emits no --compression when the track list is empty', () => {
        const args = buildMkvmergeChaptersArgs('out/ep01.mkv', [], []);
        expect(args).not.toContain('--compression');
    });

    it('emits no --compression when the track list is undefined', () => {
        const args = buildMkvmergeChaptersArgs('out/ep01.mkv', [], undefined);
        expect(args).not.toContain('--compression');
    });

    it('still supports chapters alongside compression', () => {
        const args = buildMkvmergeChaptersArgs(
            'out/ep01.mkv',
            [{ path: 'src/ep01.mkv', delay: -1000 }],
            [1],
        );

        expect(args).toContain('--compression');
        expect(args).toContain('1:zlib');
        // --chapter-sync must still precede its own chapters source.
        expect(args.indexOf('--chapter-sync')).toBeLessThan(args.indexOf('src/ep01.mkv'));
        // Both options apply to the first (muxed) input.
        expect(args.indexOf('--compression')).toBeLessThan(args.indexOf('out/ep01.mkv'));
    });
});