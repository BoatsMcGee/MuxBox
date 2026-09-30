import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// The store imports @app/preload at module load, which pulls in the native
// muxer bridge. Stub the surface the store actually touches so the pure state
// transitions under test can run in plain Node.
vi.mock('@app/preload', () => ({
    processEpisode: vi.fn(async () => undefined),
    processBatch: vi.fn(async () => undefined),
    abortProcessing: vi.fn(),
    getCpuCount: vi.fn(() => 4),
    getSettings: vi.fn(async () => ({})),
}));

vi.mock('@/stores/useProjectStore', () => ({
    useProjectStore: () => ({ currentProject: { id: 'p1' } }),
}));

// Each test resets modules so the Pinia store definition is re-evaluated and
// module-level state starts fresh.
beforeEach(() => {
    vi.resetModules();
    setActivePinia(createPinia());
});

async function loadStore() {
    const mod = await import('@/stores/useEpisodeQueueStore');
    return { store: mod.useEpisodeQueueStore(), mod };
}

/** Build a queue row with sensible defaults. */
function row(id: string, overrides: Partial<{ enabled: boolean; status: string }> = {}) {
    return { id, enabled: true, status: 'pending', ...overrides };
}

// ─── computeQueueCompletionStats ────────────────────────────

describe('computeQueueCompletionStats', () => {
    it('ignores progress entries for episodes no longer in the queue', async () => {
        const { mod } = await loadStore();
        // Regression: 12 episodes muxed, then the sources for episodes 7-12
        // were removed. Twelve progress entries stay marked completed, but six
        // of them describe rows that are no longer in the queue.
        const statuses = new Map<string, 'completed'>([]);
        for (let i = 1; i <= 12; i++) statuses.set(`ep${i}`, 'completed');

        const episodes = [row('ep1'), row('ep2'), row('ep3'), row('ep4'), row('ep5'), row('ep6')];

        const stats = mod.computeQueueCompletionStats(episodes, (id) => statuses.get(id));

        expect(stats.completed).toBe(6);
        expect(stats.total).toBe(6);
    });

    it('excludes disabled episodes from both the numerator and the total', async () => {
        const { mod } = await loadStore();
        const statuses = new Map<string, 'completed'>([['a', 'completed'], ['b', 'completed']]);

        const stats = mod.computeQueueCompletionStats(
            [row('a'), row('b', { enabled: false })],
            (id) => statuses.get(id),
        );

        expect(stats).toEqual({ completed: 1, errors: 0, total: 1 });
    });

    it('excludes episodes still probing their sources', async () => {
        const { mod } = await loadStore();
        const statuses = new Map<string, 'completed'>([['a', 'completed']]);

        const stats = mod.computeQueueCompletionStats(
            [row('a'), row('b', { status: 'loading' })],
            (id) => statuses.get(id),
        );

        expect(stats).toEqual({ completed: 1, errors: 0, total: 1 });
    });

    it('counts errored episodes separately', async () => {
        const { mod } = await loadStore();
        const statuses = new Map<string, 'completed' | 'error' | 'muxing'>([
            ['a', 'completed'],
            ['b', 'error'],
            ['c', 'muxing'],
        ]);

        const stats = mod.computeQueueCompletionStats(
            [row('a'), row('b'), row('c')],
            (id) => statuses.get(id),
        );

        expect(stats).toEqual({ completed: 1, errors: 1, total: 3 });
    });

    it('never reports more completed than total when stale entries outnumber live rows', async () => {
        const { mod } = await loadStore();
        const statuses = new Map<string, 'completed'>([]);
        for (let i = 1; i <= 12; i++) statuses.set(`gone${i}`, 'completed');
        statuses.set('live1', 'completed');

        const stats = mod.computeQueueCompletionStats([row('live1')], (id) => statuses.get(id));

        expect(stats.completed).toBeLessThanOrEqual(stats.total);
        expect(stats).toEqual({ completed: 1, errors: 0, total: 1 });
    });

    it('treats rows with no progress entry as incomplete', async () => {
        const { mod } = await loadStore();
        const stats = mod.computeQueueCompletionStats([row('a'), row('b')], () => undefined);

        expect(stats).toEqual({ completed: 0, errors: 0, total: 2 });
    });

    it('returns zeroes for an empty queue', async () => {
        const { mod } = await loadStore();
        const stats = mod.computeQueueCompletionStats([], () => 'completed');

        expect(stats).toEqual({ completed: 0, errors: 0, total: 0 });
    });
});

// ─── invalidateEpisode ──────────────────────────────────────

describe('invalidateEpisode', () => {
    it('moves a completed episode back to pending and clears stale stats', async () => {
        const { store } = await loadStore();
        store.setProgress('a', { status: 'completed', progress: 100, currentStep: 'Completed' });
        store.setProgress('a', {
            elapsedMs: 5000,
            pps: 1200,
            estimatedRemainingMs: 0,
            totalTimecode: '00:24:00.000',
            totalPacketsWritten: 90000,
            trackProgress: { 0: { packetsWritten: 500, percent: 100, packetsPerSecond: 100 } },
        });

        store.invalidateEpisode('a');

        const progress = store.getProgress('a');
        expect(progress.status).toBe('pending');
        expect(progress.progress).toBe(0);
        expect(progress.currentStep).toBe('');
        expect(progress.elapsedMs).toBeUndefined();
        expect(progress.pps).toBeUndefined();
        expect(progress.totalTimecode).toBeUndefined();
        expect(progress.totalPacketsWritten).toBeUndefined();
        expect(progress.trackProgress).toBeUndefined();
    });

    it('requeues the episode so the next batch picks it up', async () => {
        const { store } = await loadStore();
        store.setProgress('a', { status: 'completed', progress: 100 });

        store.invalidateEpisode('a');

        expect(store.processingQueue).toContain('a');
    });

    it('clears a stale error message', async () => {
        const { store } = await loadStore();
        store.setProgress('a', { status: 'error', progress: 40, error: 'boom' });

        store.invalidateEpisode('a');

        expect(store.getProgress('a').error).toBeUndefined();
    });

    it('is a no-op while the episode is muxing', async () => {
        const { store } = await loadStore();
        store.setProgress('a', { status: 'muxing', progress: 55, currentStep: 'Muxing in progress...' });

        store.invalidateEpisode('a');

        const progress = store.getProgress('a');
        expect(progress.status).toBe('muxing');
        expect(progress.progress).toBe(55);
    });

    it('is a no-op while the episode is preprocessing', async () => {
        const { store } = await loadStore();
        store.setProgress('a', { status: 'preprocessing', progress: 5 });

        store.invalidateEpisode('a');

        expect(store.getProgress('a').status).toBe('preprocessing');
    });

    it('does not abort in-flight work the way resetEpisode does', async () => {
        const { abortProcessing } = await import('@app/preload');
        const { store } = await loadStore();
        store.setProgress('a', { status: 'completed', progress: 100 });

        store.invalidateEpisode('a');

        expect(vi.mocked(abortProcessing)).not.toHaveBeenCalled();
    });

    it('leaves other episodes untouched', async () => {
        const { store } = await loadStore();
        store.setProgress('a', { status: 'completed', progress: 100 });
        store.setProgress('b', { status: 'completed', progress: 100 });

        store.invalidateEpisode('a');

        expect(store.getProgress('b').status).toBe('completed');
    });
});
