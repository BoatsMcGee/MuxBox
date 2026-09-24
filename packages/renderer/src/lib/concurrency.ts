// Concurrency control utility for renderer-side coordination.
// The actual semaphore for FFmpeg-native calls (Demuxer.open) lives in the preload
// layer since that's where node-av runs. This module provides:
//  1. The total concurrency constant (exposed from preload)
//  2. A renderer-friendly helper for batching promises with concurrency

/**
 * Execute an array of async factories with a concurrency limit.
 * Accepts an optional AbortSignal — when aborted, workers stop pulling
 * new items from the queue. In-flight tasks complete naturally.
 *
 * This is used in the SourceEditView to batch demuxStreams calls.
 */
export async function runConcurrent<T>(
    items: T[],
    factory: (item: T, index: number) => Promise<unknown>,
    concurrency: number,
    signal?: AbortSignal,
): Promise<void> {
    const running: Promise<void>[] = [];
    const len = items.length;
    let i = 0;

    function next(): Promise<void> {
        if (i >= len || signal?.aborted) return Promise.resolve();
        const idx = i++;
        const task = factory(items[idx], idx)
            .then(() => {})
            .catch(() => {});
        return task;
    }

    const workers = new Array(Math.min(concurrency, len));
    for (let w = 0; w < workers.length; w++) {
        workers[w] = (async () => {
            while (i < len && !signal?.aborted) {
                const task = next();
                running.push(task);
                await task;
            }
        })();
    }

    await Promise.all(workers);
    await Promise.all(running);
}

/**
 * Get the renderer-visible concurrency limit.
 * The preload exposes this based on os.cpus().length.
 */
export const MAX_DEMUX_CONCURRENCY = 4;
