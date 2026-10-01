/**
 * Worker thread entry point for running a single EpisodeMuxer job.
 *
 * Each worker loads its own node-av native addon instance, so
 * Demuxer/Muxer/Packet objects never need to cross thread boundaries.
 * The episode passed via workerData is plain JSON (structured-cloneable)
 * and already has any queue overrides merged by the renderer.
 *
 * Receives:  { episode: Episode, processId: string } via workerData
 * Sends to parent:
 *   { type: 'tracks', tracks: TrackComparison[] }
 *   { type: 'progress', snapshot: MuxSnapshot }
 *   { type: 'complete', fileName?: string, skipped?: string }
 *   { type: 'error', error: string }
 * Receives from parent:
 *   { type: 'cancel' }  (best-effort; see coordinator cancelJob for terminate())
 */

import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { EpisodeMuxer } from '../episode/muxer.js';
import { mkvmergeChapters } from '@app/mkvtoolnix';
import type { Episode } from '../episode/types.js';
import type { MuxSnapshot, TrackComparison } from '../episode/progress.js';

// Worker-specific: only run when not on main thread
if (isMainThread) {
    throw new Error('episode-worker.ts should only be run as a worker thread');
}

const port = parentPort!;

interface WorkerJob {
    episode: Episode;
    processId: string;
}

interface WorkerInboundMessage {
    type: 'cancel';
}

interface WorkerOutboundMessage {
    type: 'tracks' | 'progress' | 'complete' | 'error' | 'cancelled' | 'skipped';
    tracks?: TrackComparison[];
    snapshot?: MuxSnapshot;
    fileName?: string;
    error?: string;
    reason?: string;
}
function post(msg: WorkerOutboundMessage): void {
    port.postMessage(msg);
}

async function run(): Promise<void> {
    const { episode } = workerData as WorkerJob;

    // Handle cancellation from parent. The mux loop aborts via muxer.cancel();
    // a `cancelled` flag also lets us bail out promptly during the preprocess
    // phase (before the mux loop exists), where muxer.cancel() is a no-op.
    let muxer: EpisodeMuxer | undefined;
    let cancelled = false;
    // Last known snapshot (progress/error/complete). Retained at run() scope
    // so catch-path errors can forward it even when init/preprocess throws
    // before the merge loop emits its first progress event.
    let lastSnapshot: MuxSnapshot | undefined;
    const cancelHandler = (msg: WorkerInboundMessage): void => {
        if (msg.type === 'cancel') {
            cancelled = true;
            muxer?.cancel('cancelled');
        }
    };
    port.on('message', cancelHandler);

    try {
        // Create and run the muxer
        await using epMuxer = await EpisodeMuxer.init(episode);
        muxer = epMuxer;

        // Forward tracks:ready to parent (emitted during mux(), before merge loop)
        epMuxer.on('tracks:ready', (tracks: TrackComparison[]) => {
            post({ type: 'tracks', tracks });
        });

        // Forward mux:progress to parent. Also retained as the fallback
        // snapshot for terminal error posts when no mux:error snapshot exists
        // (e.g. init/preprocess throw before the merge loop starts).
        epMuxer.on('mux:progress', (snapshot: MuxSnapshot) => {
            lastSnapshot = snapshot;
            post({ type: 'progress', snapshot });
        });

        // Forward mux:error to parent. A cancellation surfaces as mux:error
        // with error='cancelled' (the mux loop emits it before returning), so
        // distinguish it from a real failure and report it as 'cancelled'.
        // The snapshot is also retained so catch-path errors can forward it.
        epMuxer.on('mux:error', (errSnapshot: MuxSnapshot) => {
            lastSnapshot = errSnapshot;
            if (cancelled) {
                post({ type: 'cancelled' });
                return;
            }
            post({
                type: 'error',
                error: errSnapshot.error ?? 'unknown error',
                snapshot: errSnapshot,
            });
        });

        // Capture the final mux:complete snapshot for the parent.
        // A complete without a snapshot is legal (skipped: already exists,
        // no video) — the coordinator/main layers handle undefined.
        let finalSnapshot: MuxSnapshot | undefined;
        epMuxer.on('mux:complete', (snapshot: MuxSnapshot) => {
            finalSnapshot = snapshot;
            lastSnapshot = snapshot;
        });

        // Phase 1: Preprocess (selectors, opusenc etc.)
        await epMuxer.preprocess();

        // Honour a cancel that arrived during preprocess before starting mux.
        if (cancelled) {
            post({ type: 'cancelled' });
            return;
        }

        // Phase 2: Mux (streaming k-way merge)
        const fileName = await epMuxer.mux();

        if (cancelled) {
            // The mux:error handler already posted 'cancelled' when the loop
            // aborted. Do not post a second terminal message.
            return;
        }

        if (!fileName) {
            // Skipped (already exists, no video, etc.) — nothing to post-process
            post({ type: 'complete', fileName: undefined, snapshot: finalSnapshot });
            return;
        }

        // Phase 3: Post-process with mkvmerge (chapters + subtitle compression)
        const filePath = path.resolve(episode.file.directory, `${fileName}.mkv`);
        const chaptersSources = episode.chaptersSource
            ? [{ path: path.resolve(episode.chaptersSource.directory, episode.chaptersSource.fileName), delay: episode.chaptersSource.delay }]
            : episode.sources
                .filter(source => source.chapters)
                .map(source => ({
                    path: path.resolve(source.file.directory, source.file.name),
                    delay: source.chapters?.delay,
                }));
        // Also run when there are no chapters, so subtitle zlib compression still
        // happens — mkvmerge is the only component that can apply it.
        const compressTrackIds = epMuxer.compressibleSubtitleTrackIds;
        if (chaptersSources.length > 0 || compressTrackIds.length > 0) {
            await mkvmergeChapters(filePath, chaptersSources, compressTrackIds);
        }

        post({ type: 'complete', fileName, snapshot: finalSnapshot });
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        post({ type: 'error', error: errMsg, snapshot: lastSnapshot });
    } finally {
        port.removeListener('message', cancelHandler);
    }
}

run().catch(err => {
    post({
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
    });
});
