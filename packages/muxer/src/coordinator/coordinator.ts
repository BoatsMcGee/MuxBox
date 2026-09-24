/**
 * MuxCoordinator — manages concurrent muxing of multiple episodes using
 * worker threads. Each job runs in its own worker thread with an independent
 * node-av instance, enabling true parallel execution across CPU cores.
 *
 * Ported from the CLI version (multimux-core) and adapted to this app's
 * event model. All muxing (single episode or batch) routes through this
 * coordinator for uniformity.
 *
 * Cancellation is graceful: the coordinator sends a 'cancel' message and the
 * worker aborts its mux loop (which yields every 500 packets), letting node-av
 * clean up its own native resources. worker.terminate() is only used as a
 * last-resort fallback if the worker does not exit within a timeout — a hard
 * terminate mid-native-FFmpeg-call can corrupt the process-shared FFmpeg state
 * (the main process also uses node-av), so it must be avoided in the normal path.
 */

import EventEmitter from 'node:events';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Episode } from '../episode/types.js';
import type { MuxSnapshot, TrackComparison } from '../episode/progress.js';

/**
 * How long to wait for a worker to exit after a graceful 'cancel' message
 * before force-terminating it. The mux loop yields to the event loop every
 * 500 packets, so this window is far longer than needed in the normal path;
 * it only fires if the worker is stuck in a native call that never yields.
 */
const WORKER_CANCEL_TIMEOUT_MS = 15_000;

// #region Types

export interface EpisodeJob {
    episode: Episode;
    processId: string;
}

export type JobStatus = 'queued' | 'preprocessing' | 'muxing' | 'postprocessing' | 'complete' | 'failed' | 'cancelled';

export interface JobState {
    id: string;
    episode: Episode;
    processId: string;
    status: JobStatus;
    episodeLabel: string;
    worker: Worker | undefined;
    progress: MuxSnapshot | undefined;
    tracks: TrackComparison[] | undefined;
    error: string | undefined;
    startedAt: number | undefined;
    completedAt: number | undefined;
    result: string | undefined;
    skipped: boolean;
}

// #endregion Types

// #region Event declarations

export interface MuxCoordinatorEvents {
    'job:started': [state: JobState];
    'job:tracks': [state: JobState, tracks: TrackComparison[]];
    'job:progress': [state: JobState, snapshot: MuxSnapshot];
    'job:complete': [state: JobState, result: string | undefined, snapshot?: MuxSnapshot];
    'job:failed': [state: JobState, error: string];
    'job:cancelled': [state: JobState];
    'all:complete': [];
}

// #endregion Event declarations

/**
 * Resolve the path to the worker script.
 *
 * In the built app the worker is emitted by the @app/main Vite build as a
 * sibling chunk next to dist/index.js (see vite.config.js rollupOptions.input).
 * In dev the main package is built the same way (dev-mode.js runs vite build),
 * so the same path resolution applies. This module is bundled into both the
 * main process bundle and the worker chunk; in the worker chunk this is a
 * no-op because the worker never constructs a coordinator.
 */
function getWorkerPath(): string {
    // __dirname equivalent for ESM
    const dir = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(dir, 'episode-worker.js');
}

/**
 * Manages concurrent processing of multiple episodes using worker threads.
 */
export class MuxCoordinator extends EventEmitter {
    private queue: EpisodeJob[] = [];
    private active = new Map<string, JobState>();
    private readonly concurrency: number;
    private started = false;
    private resolveAll: (() => void) | undefined;
    private jobCounter = 0;
    private readonly workerPath: string;

    constructor(concurrency: number = 2) {
        super();
        this.concurrency = Math.max(1, concurrency);
        this.workerPath = getWorkerPath();
    }

    // #region Public API

    /**
     * Add episodes to the queue for processing.
     * Each episode will be processed in its own worker thread.
     */
    addJobs(jobs: EpisodeJob[]): void {
        for (const job of jobs) {
            const episodeLabel = this.buildEpisodeLabel(job.episode);
            this.queue.push(job);
            const state: JobState = {
                id: `job-${++this.jobCounter}`,
                episode: job.episode,
                processId: job.processId,
                status: 'queued',
                episodeLabel,
                worker: undefined,
                progress: undefined,
                tracks: undefined,
                error: undefined,
                startedAt: undefined,
                completedAt: undefined,
                result: undefined,
                skipped: false,
            };
            this.active.set(state.id, state);
        }
    }

    /** Get current state of all jobs (queued + active + completed). */
    getAllJobs(): JobState[] {
        return [...this.active.values()];
    }

    /** Whether all jobs have reached a terminal state. */
    isDone(): boolean {
        return this.getAllJobs().every(
            j => j.status === 'complete' || j.status === 'failed' || j.status === 'cancelled',
        );
    }

    /** Cancel a specific job by processId. */
    cancelJob(processId: string): void {
        for (const [, state] of this.active) {
            if (state.processId === processId) {
                this.cancelWorker(state);
                return;
            }
        }
    }

    /** Cancel all active jobs and clear the queue. */
    cancelAll(): void {
        this.queue = [];
        for (const [, state] of this.active) {
            if (state.status === 'queued' || state.status === 'complete' || state.status === 'failed') {
                continue;
            }
            this.cancelWorker(state);
        }
    }

    /** Start processing the queue. */
    start(): void {
        if (this.started) return;
        this.started = true;
        void this.processNext();
    }

    /** Wait for all jobs to complete. */
    waitForAll(): Promise<void> {
        if (this.isDone()) {
            return Promise.resolve();
        }
        return new Promise<void>(resolve => {
            this.resolveAll = resolve;
        });
    }

    // #endregion Public API

    // #region Internal

    private buildEpisodeLabel(episode: Episode): string {
        const s = episode.series.season.number.toString().padStart(2, '0');
        const e = episode.series.episode.number.toString().padStart(2, '0');
        return `S${s}E${e} - ${episode.series.episode.name ?? ''}`;
    }

    /**
     * Cancel a running worker gracefully.
     *
     * Sends a 'cancel' message so the worker can abort its mux loop and let
     * node-av clean up its own native resources (output.closeSync, reader
     * close, asyncDispose). Never terminate() mid-native-call in the normal
     * path: the main process shares the node-av native library (probing,
     * model building), and a hard kill corrupts FFmpeg's process-shared state,
     * crashing the whole app (segfault / crashpad "not connected").
     *
     * terminate() is used only as a last-resort fallback if the worker does
     * not exit within WORKER_CANCEL_TIMEOUT_MS.
     */
    private cancelWorker(state: JobState): void {
        if (!state.worker) return;
        const worker = state.worker;

        // Mark the job as cancelled BEFORE posting the cancel message.
        // This prevents the exit handler from emitting job:failed if the
        // worker exits before posting { type: 'cancelled' } back.
        state.status = 'cancelled';

        // Graceful path: ask the worker to abort. The mux loop checks the
        // abort signal every iteration and yields every 500 packets, so the
        // message is observed within milliseconds during muxing.
        try {
            worker.postMessage({ type: 'cancel' });
        } catch {
            // Worker may already be terminating
        }

        // Last-resort fallback: force-terminate if the worker never exits.
        const terminateTimer = setTimeout(() => {
            try {
                worker.terminate();
            } catch {
                // Already terminated or terminating
            }
        }, WORKER_CANCEL_TIMEOUT_MS);
        terminateTimer.unref?.();

        worker.once('exit', () => clearTimeout(terminateTimer));

        // Mark the worker as no longer owned so processNext can schedule the
        // next job. The exit handler in runJob still observes the exit code.
        state.worker = undefined;
    }

    private async processNext(): Promise<void> {
        while (this.queue.length > 0) {
            // Count total active jobs (preprocessing + muxing + postprocessing)
            // against concurrency for overall parallelism.
            const totalActive = [...this.active.values()].filter(
                j => j.status === 'preprocessing' || j.status === 'muxing' || j.status === 'postprocessing',
            ).length;

            if (totalActive >= this.concurrency) {
                return;
            }

            // Only allow 1 worker at a time in the FFmpeg-native init/
            // preprocess phase. Once the worker emits 'tracks', it has entered
            // the mux merge loop (writePacketSync) which does not contend on
            // avformat_open_input/the FFmpeg global state. At that point the
            // next worker is freed to start init.
            const preprocessingCount = [...this.active.values()].filter(
                j => j.status === 'preprocessing',
            ).length;

            if (preprocessingCount >= 1) {
                return;
            }

            const job = this.queue.shift()!;
            const state = [...this.active.values()].find(j => j.episode === job.episode);
            if (!state) continue;

            void this.runJob(job, state);
        }

        if (this.isDone()) {
            this.resolveAll?.();
            this.emit('all:complete');
        }
    }

    private async runJob(job: EpisodeJob, state: JobState): Promise<void> {
        try {
            state.status = 'preprocessing';
            state.startedAt = Date.now();
            this.emit('job:started', state);

            // Spawn a worker thread for this job
            const worker = new Worker(this.workerPath, {
                workerData: {
                    episode: job.episode,
                    processId: job.processId,
                },
                // type: 'module' — Vite emits ESM chunks
            });
            state.worker = worker;

            // Handle worker messages
            worker.on('message', (msg: {
                type: string;
                snapshot?: MuxSnapshot;
                tracks?: TrackComparison[];
                fileName?: string;
                error?: string;
            }) => {
                switch (msg.type) {
                    case 'progress':
                        if (msg.snapshot !== undefined) {
                            state.progress = msg.snapshot;
                            this.emit('job:progress', state, msg.snapshot);
                        }
                        break;

                    case 'tracks':
                        state.tracks = msg.tracks!;
                        // Transition to muxing: worker has finished all FFmpeg-native
                        // init/preprocess calls and entered the mux merge loop.
                        // This releases the concurrency slot so the next worker can
                        // start its init/preprocess phase.
                        state.status = 'muxing';
                        this.emit('job:tracks', state, msg.tracks!);
                        void this.processNext();
                        break;

                    case 'complete':
                        state.status = 'complete';
                        state.result = msg.fileName;
                        state.skipped = msg.fileName === undefined;
                        state.completedAt = Date.now();
                        if (msg.snapshot !== undefined) {
                            state.progress = msg.snapshot;
                        }
                        this.emit('job:complete', state, msg.fileName, msg.snapshot);
                        this.workerDone(state);
                        break;

                    case 'error':
                        state.status = 'failed';
                        state.error = msg.error ?? 'unknown error';
                        state.completedAt = Date.now();
                        if (msg.snapshot !== undefined) {
                            state.progress = msg.snapshot;
                        }
                        this.emit('job:failed', state, state.error);
                        this.workerDone(state);
                        break;

                    case 'cancelled':
                        state.status = 'cancelled';
                        state.completedAt = Date.now();
                        this.emit('job:cancelled', state);
                        this.workerDone(state);
                        break;
                }
            });

            // Handle worker errors
            worker.on('error', (err: Error) => {
                state.status = 'failed';
                state.error = err.message;
                state.completedAt = Date.now();
                this.emit('job:failed', state, err.message);
                this.workerDone(state);
            });

            // Handle worker exit
            worker.on('exit', (code) => {
                if (code !== 0 && state.status !== 'complete' && state.status !== 'failed') {
                    state.status = 'failed';
                    state.error = `Worker exited with code ${code}`;
                    state.completedAt = Date.now();
                    this.emit('job:failed', state, state.error);
                    this.workerDone(state);
                }
            });

        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            state.status = 'failed';
            state.error = errMsg;
            state.completedAt = Date.now();
            this.emit('job:failed', state, errMsg);
            void this.processNext();
        }
    }

    /** Clean up after a worker finishes and process next job. */
    private workerDone(state: JobState): void {
        if (state.worker) {
            try {
                state.worker.removeAllListeners();
            } catch {
                // Already terminated
            }
            state.worker = undefined;
        }
        void this.processNext();
    }

    // #endregion Internal
}
