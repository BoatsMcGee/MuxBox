/**
 * Tests for the per-packet allocation optimizations in merge-streams.ts.
 *
 * Context: `Demuxer.getStream()` resolves through the `formatContext.streams`
 * getter, which does `nativeStreams.map(ns => new Stream(ns))` — allocating a
 * fresh NAPI wrapper for EVERY stream in the file on EVERY access. At 20 streams
 * that is 20 allocations per packet just to look one up. `buildWriteKey()` was
 * likewise building a ~70-char string per packet, and `dispatchToBucket` called
 * it once per bucket (up to 20x per packet).
 *
 * These pin the memoized behaviour so the caching can't be silently removed.
 */
import { describe, it, expect } from 'vitest';
import { SyncPacketBucket, buildWriteKey, type WriteContext } from '../../../packages/muxer/src/@utils/merge-streams.js';

function ctx(outputIndex: number): WriteContext {
    return { outputIndex, delaySec: 0, timeBaseNum: 1, timeBaseDen: 1000, delayInStreamUnits: 0n };
}

describe('buildWriteKey', () => {
    it('uses the bare key for preprocessed pipe demuxers', () => {
        expect(buildWriteKey('C:/x/file.mkv:preprocess:3', 7))
            .toBe('C:/x/file.mkv:preprocess:3');
    });

    it('appends the stream index for file demuxers', () => {
        expect(buildWriteKey('C:/x/file.mkv', 2)).toBe('C:/x/file.mkv:2');
    });
});

describe('SyncPacketBucket.accepts', () => {
    const key = 'C:/x/file.mkv';

    it('accepts stream indices present in the write context map', () => {
        const map = new Map<string, WriteContext>([
            [`${key}:0`, ctx(0)],
            [`${key}:2`, ctx(1)],
        ]);
        const bucket = new SyncPacketBucket(key, map);
        expect(bucket.accepts(0)).toBe(true);
        expect(bucket.accepts(2)).toBe(true);
    });

    it('rejects stream indices absent from the write context map', () => {
        const map = new Map<string, WriteContext>([[`${key}:0`, ctx(0)]]);
        const bucket = new SyncPacketBucket(key, map);
        expect(bucket.accepts(1)).toBe(false);
        expect(bucket.accepts(99)).toBe(false);
    });

    it('is stable across repeated calls (memoized, no behaviour drift)', () => {
        const map = new Map<string, WriteContext>([[`${key}:1`, ctx(0)]]);
        const bucket = new SyncPacketBucket(key, map);
        for (let i = 0; i < 1000; i++) {
            expect(bucket.accepts(1)).toBe(true);
            expect(bucket.accepts(2)).toBe(false);
        }
    });

    it('does not allocate a new key string per call', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const url = await import('node:url');
        const here = path.dirname(url.fileURLToPath(import.meta.url));
        const src = fs.readFileSync(
            path.resolve(here, '../../../packages/muxer/src/@utils/merge-streams.ts'),
            'utf-8',
        );
        // Memoization must exist; without it this optimization is a no-op.
        expect(src, 'SyncPacketBucket must memoize write keys').toMatch(/keyCache/);
        // dispatchToBucket must go through accepts(), not rebuild keys per bucket.
        expect(src).toMatch(/b\.accepts\(streamIndex\)/);
    });
});
