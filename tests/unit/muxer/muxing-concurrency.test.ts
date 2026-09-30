/**
 * Regression test for muxing concurrency resolution.
 *
 * Bug: `DEFAULT_SETTINGS.muxingConcurrency` was `0` in
 * `packages/preload/src/main-exports.ts` while the renderer resolved it with
 * `settings.muxingConcurrency ?? Math.max(1, cpuCount - 1)`. `??` only treats
 * `null`/`undefined` as nullish, so `0` passed straight through, the
 * coordinator's `Math.max(1, 0)` clamped it to 1, and batch muxing silently
 * ran on a single worker (one core) regardless of machine core count.
 *
 * This pins the resolution rule so a non-positive default can't silently
 * disable parallelism again.
 */
import { describe, it, expect } from 'vitest';

/**
 * Mirrors the resolution in useEpisodeQueueStore.ts. Kept in sync deliberately:
 * the store's expression is inside a Pinia composable that cannot be imported
 * without a Vue app, so the rule is duplicated here and asserted by reading the
 * real source below.
 */
function resolveConcurrency(configured: number | undefined, cpuCount: number): number {
    return configured !== undefined && configured > 0
        ? Math.min(configured, cpuCount)
        : Math.max(1, cpuCount - 1);
}

describe('muxing concurrency resolution', () => {
    it('falls back to cpuCount - 1 when unset', () => {
        expect(resolveConcurrency(undefined, 12)).toBe(11);
    });

    it('treats 0 as unset rather than passing it through', () => {
        // The bug: `0 ?? 11` === 0, which the coordinator clamped to 1.
        expect(resolveConcurrency(0, 12)).toBe(11);
    });

    it('treats negative values as unset', () => {
        expect(resolveConcurrency(-4, 12)).toBe(11);
    });

    it('honours an explicit positive setting', () => {
        expect(resolveConcurrency(4, 12)).toBe(4);
    });

    it('never exceeds the core count', () => {
        expect(resolveConcurrency(64, 12)).toBe(12);
    });

    it('always returns at least 1', () => {
        expect(resolveConcurrency(undefined, 1)).toBe(1);
        expect(resolveConcurrency(0, 1)).toBe(1);
        expect(resolveConcurrency(2, 1)).toBe(1);
    });

    it('ships defaults that do not pin concurrency to 1', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const url = await import('node:url');
        const here = path.dirname(url.fileURLToPath(import.meta.url));

        // Both AppSettings copies must leave it undefined. A hard-coded 0 is the
        // exact regression; any non-positive number is equally harmful.
        for (const rel of [
            '../../../packages/preload/src/main-exports.ts',
            '../../../packages/settings/src/types.ts',
        ]) {
            const src = fs.readFileSync(path.resolve(here, rel), 'utf-8');
            const m = src.match(/muxingConcurrency:\s*([^,\n}]+)/);
            expect(m, `no muxingConcurrency default found in ${rel}`).not.toBeNull();
            const value = m![1]!.trim();
            expect(
                value,
                `${rel} sets muxingConcurrency to ${value}; it must be undefined so the renderer can fall back to cpuCount - 1`,
            ).toBe('undefined');
        }
    });

    it('guards against non-positive settings in the renderer store', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const url = await import('node:url');
        const here = path.dirname(url.fileURLToPath(import.meta.url));
        const src = fs.readFileSync(
            path.resolve(here, '../../../packages/renderer/src/stores/useEpisodeQueueStore.ts'),
            'utf-8',
        );
        // Must compare against 0, not rely on `??` alone.
        expect(src, 'renderer must guard configured concurrency with `> 0`').toMatch(
            /configured\s*!==\s*undefined\s*&&\s*configured\s*>\s*0/,
        );
    });
});
