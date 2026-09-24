import { ipcMain } from 'electron';
import type { AppModule } from '../AppModule.js';
import type { ModuleContext } from '../ModuleContext.js';
import {
    MuxCoordinator,
    serializeSnapshot,
    type MuxSnapshot,
    type Episode,
    type StreamInfo,
    type MuxerModel,
    type JobState,
    buildEpisodeModel,
    demuxStreams,
    clearProbeCache,
    getCodecConstants,
    getCodecEntryList,
    ALL_DISPOSITIONS,
} from '@app/muxer';
import { Logger } from '@app/utils';
import path from 'node:path';
import { cpus } from 'node:os';

const log = new Logger('MuxerHandler');

/**
 * Active MuxCoordinator instances keyed by processId of their jobs.
 * Used by abortProcessing to find the coordinator owning a job.
 * (Only batch coordinators and single-job coordinators are tracked; a job
 * registers itself in wireJobEvents.)
 */
const coordinatorsByProcessId = new Map<string, MuxCoordinator>();

/**
 * Per-coordinator map of processId → WebContents for the job events wired in
 * wireJobEvents. Listeners are registered once per coordinator and dispatch
 * to each job's sender by processId.
 */
const jobSendersByCoordinator = new WeakMap<MuxCoordinator, Map<string, Electron.WebContents>>();

/**
 * Wire a coordinator's job events to the renderer over IPC, reusing the
 * existing `muxer:${channel}:${processId}` channel naming so the renderer
 * UI wiring is unchanged. Also registers the coordinator for abort lookups.
 *
 * A single set of listeners is registered per coordinator (not per job), and
 * each event is dispatched to the job's own sender by processId. Per-job
 * listeners on the shared coordinator emitter cause every job's listener to
 * fire when ANY job completes — the first completion marks all episodes as
 * completed at once — and a large batch exceeds EventEmitter's default
 * listener limit (MaxListenersExceeded warnings).
 */
function wireJobEvents(coordinator: MuxCoordinator, state: JobState, sender: Electron.WebContents): void {
    const { processId } = state;

    let sendersByProcessId = jobSendersByCoordinator.get(coordinator);
    if (sendersByProcessId === undefined) {
        sendersByProcessId = new Map<string, Electron.WebContents>();
        jobSendersByCoordinator.set(coordinator, sendersByProcessId);

        // Drop a finished job's sender and abort-lookup entry.
        const removeJob = (s: JobState): void => {
            sendersByProcessId?.delete(s.processId);
            if (coordinatorsByProcessId.get(s.processId) === coordinator) {
                coordinatorsByProcessId.delete(s.processId);
            }
        };

        coordinator.on('job:progress', (s: JobState, snap: MuxSnapshot): void => {
            const jobSender = sendersByProcessId?.get(s.processId);
            if (jobSender === undefined) return;
            try {
                jobSender.send(`muxer:progress:${s.processId}`, serializeSnapshot(snap));
            } catch (err) {
                log.error('job:progress send failed:', { processId: s.processId, error: err instanceof Error ? err.message : String(err) });
            }
        });
        coordinator.on('job:started', (s: JobState): void => {
            sendersByProcessId?.get(s.processId)?.send(`muxer:started:${s.processId}`);
        });
        coordinator.on('job:complete', (s: JobState, fileName: string | undefined, snapshot?: MuxSnapshot): void => {
            const jobSender = sendersByProcessId?.get(s.processId);
            if (jobSender === undefined) return;
            try {
                if (fileName !== undefined) {
                    jobSender.send(`muxer:complete:${s.processId}`, serializeSnapshot(snapshot ?? s.progress));
                } else {
                    jobSender.send(`muxer:skipped:${s.processId}`, { reason: 'already exists', fileName });
                }
            } catch (err) {
                log.error('job:complete send failed:', { processId: s.processId, error: err instanceof Error ? err.message : String(err) });
            }
            removeJob(s);
        });
        coordinator.on('job:failed', (s: JobState, error: string): void => {
            const jobSender = sendersByProcessId?.get(s.processId);
            if (jobSender === undefined) return;
            try {
                const payload = serializeSnapshot(s.progress);
                jobSender.send(`muxer:error:${s.processId}`, { message: error, snapshot: payload });
            } catch (err) {
                log.error('job:failed send failed:', { processId: s.processId, error: err instanceof Error ? err.message : String(err) });
            }
            removeJob(s);
        });
        coordinator.on('job:cancelled', (s: JobState): void => {
            const jobSender = sendersByProcessId?.get(s.processId);
            if (jobSender === undefined) return;
            jobSender.send(`muxer:cancelled:${s.processId}`);
            removeJob(s);
        });
    }

    sendersByProcessId.set(processId, sender);
    coordinatorsByProcessId.set(processId, coordinator);
}

/**
 * Run a single episode through a fresh coordinator and resolve with the
 * output file name. Used by the `muxer:processEpisode` handler.
 *
 * The job's events are already wired to IPC via wireJobEvents, so the
 * renderer receives progress/complete/error/skipped over the same channels.
 * This promise only settles the ipcRenderer.invoke() call: it resolves with
 * the file name on success (or undefined for skipped), and rejects on failure
 * so the renderer's catch block sees the error.
 */
async function runCoordinatorJob(
    coordinator: MuxCoordinator,
    episode: Episode,
    processId: string,
    sender: Electron.WebContents,
): Promise<string | undefined> {
    coordinator.addJobs([{ episode, processId }]);
    const state = coordinator.getAllJobs()[0]!;
    wireJobEvents(coordinator, state, sender);

    return await new Promise<string | undefined>((resolve, reject) => {
        coordinator.on('job:complete', (_s, fileName) => resolve(fileName));
        coordinator.on('job:failed', (_s, error) => reject(new Error(error)));
        // Cancellation is a clean stop, not a failure — resolve undefined
        // (mirrors the mux() returning undefined on cancel).
        coordinator.on('job:cancelled', () => resolve(undefined));
        coordinator.start();
    });
}

export class MuxerHandler implements AppModule {
    enable(_context: ModuleContext): void {
        // ─── Build MuxerModel ───────────────────────────────────
        ipcMain.handle('muxer:buildMuxerModel', async (_event, episode: Episode): Promise<MuxerModel> => {
            const streamInfoMap = new Map<string, StreamInfo[]>();
            for (const sourceEntry of episode.sources) {
                const filePath = path.resolve(sourceEntry.file.directory, sourceEntry.file.name);
                const infos = await demuxStreams(filePath);
                streamInfoMap.set(filePath, infos);
            }
            return buildEpisodeModel(episode, streamInfoMap);
        });

        // ─── Process Episode (single job through the coordinator) ──
        // All muxing (single or batch) routes through MuxCoordinator, which
        // runs each episode in its own worker thread. This is the unified path.
        ipcMain.handle(
            'muxer:processEpisode',
            async (
                event,
                episode: Episode,
                processId: string,
            ): Promise<string | undefined> => {
                const epLabel = `S${String(episode.series.season.number).padStart(2, '0')}E${String(episode.series.episode.number).padStart(2, '0')}`;
                log.info('processEpisode start:', { processId, episode: epLabel, series: episode.series.name });

                const sender = event.sender;
                const coordinator = new MuxCoordinator(1);

                return await runCoordinatorJob(coordinator, episode, processId, sender);
            },
        );

        // ─── Process Batch (multiple episodes through the coordinator) ──
        ipcMain.handle(
            'muxer:processBatch',
            async (
                event,
                jobs: { episode: Episode; processId: string }[],
                concurrency: number,
            ): Promise<void> => {
                log.info('processBatch start:', { jobs: jobs.length, concurrency });
                const sender = event.sender;
                const coordinator = new MuxCoordinator(concurrency);
                coordinator.addJobs(jobs);

                for (const state of coordinator.getAllJobs()) {
                    wireJobEvents(coordinator, state, sender);
                }

                coordinator.start();
                await coordinator.waitForAll();
            },
        );

        // ─── Abort Processing ───────────────────────────────────
        ipcMain.handle('muxer:abortProcessing', (_event, processId: string): void => {
            const coordinator = coordinatorsByProcessId.get(processId);
            if (coordinator) {
                log.info('abortProcessing: found coordinator, cancelling job:', { processId });
                coordinator.cancelJob(processId);
            } else {
                log.warn('abortProcessing: no coordinator found for', { processId });
            }
        });

        // ─── Demux Streams ──────────────────────────────────────
        ipcMain.handle('muxer:demuxStreams', async (_event, filePath: string): Promise<StreamInfo[]> => {
            return demuxStreams(filePath);
        });

        // ─── Clear Probe Cache ─────────────────────────────────
        ipcMain.handle('muxer:clearProbeCache', (): void => {
            clearProbeCache();
        });

        // ─── Codec Constants ────────────────────────────────────
        ipcMain.handle('muxer:getCodecConstants', () => {
            return getCodecConstants();
        });

        // ─── Codec Entry List ───────────────────────────────────
        ipcMain.handle('muxer:getCodecEntryList', () => {
            return getCodecEntryList();
        });

        // ─── All Dispositions ───────────────────────────────────
        ipcMain.handle('muxer:getAllDispositions', () => {
            return ALL_DISPOSITIONS;
        });

        // ─── CPU Count ──────────────────────────────────────────
        ipcMain.handle('muxer:getCpuCount', () => {
            return cpus().length;
        });
    }
}

export function createMuxerHandlerModule(): MuxerHandler {
    return new MuxerHandler();
}
