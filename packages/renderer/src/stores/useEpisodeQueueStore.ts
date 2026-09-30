import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Episode, MuxErrorPayload, MuxSnapshot, PerTrackModifier } from '@app/preload';
import { processEpisode, processBatch, abortProcessing as preloadAbortProcessing, getCpuCount, getSettings } from '@app/preload';
import { useProjectStore } from '@/stores/useProjectStore';

export type ProcessingStatus = 'idle' | 'pending' | 'preprocessing' | 'muxing' | 'completed' | 'error' | 'skipped';

export interface TrackProgress {
    packetsWritten: number;
    percent: number;
    packetsPerSecond: number;
}

export interface EpisodeProgress {
    status: ProcessingStatus;
    progress: number;
    currentStep: string;
    error?: string;
    /** Elapsed time in milliseconds (from MuxSnapshot). */
    elapsedMs?: number;
    /** Packets per second (from MuxSnapshot). */
    pps?: number;
    /** Estimated remaining time in ms (from MuxSnapshot). */
    estimatedRemainingMs?: number;
    /** Formatted timecode "HH:MM:SS.mmm" (from MuxSnapshot). */
    totalTimecode?: string;
    /** Total packets written (from MuxSnapshot). */
    totalPacketsWritten?: number;
    /** Per-track progress keyed by output index. */
    trackProgress?: Record<number, TrackProgress>;
}

/**
 * Human-readable step label derived from the muxer phase and progress range.
 */
function computeCurrentStep(status: ProcessingStatus, progress: number): string {
    switch (status) {
        case 'preprocessing':
            if (progress < 10) return 'Initializing...';
            if (progress < 30) return 'Analyzing streams...';
            if (progress < 50) return 'Matching video streams...';
            if (progress < 70) return 'Matching audio streams...';
            return 'Preprocessing complete';
        case 'muxing':
            if (progress < 30) return 'Muxing...';
            if (progress < 60) return 'Muxing in progress...';
            if (progress < 90) return 'Finalizing mux...';
            return 'Almost done...';
        case 'completed':
            return 'Completed';
        case 'error':
            return 'Error';
        case 'skipped':
            return 'Skipped';
        default:
            return '';
    }
}

/**
 * Resolve a source file path for override key matching.
 * Mirrors `path.resolve(directory, name)` — the format used by demuxerMapKey.
 * The renderer has no node:path, so this implements the same semantics for
 * the absolute Windows/Unix paths used here (no .. or . segments expected).
 */
function resolveSourcePath(directory: string, name: string): string {
    if (!directory) return name;
    const sep = directory.endsWith('/') || directory.endsWith('\\') ? '' : '/';
    return `${directory}${sep}${name}`;
}

/**
 * Merge queue track overrides (keyed `${demuxerMapKey}:${fileStreamIndex}`)
 * into an episode's per-track modifiers, mirroring what the old main-process
 * handler did. Called before the episode crosses the context bridge so the
 * worker receives a fully-resolved episode.
 */
function mergeQueueOverrides(episode: Episode, rawOverrides: Record<string, PerTrackModifier> | undefined): Episode {
    if (!rawOverrides || Object.keys(rawOverrides).length === 0) return episode;

    const merged: Episode = JSON.parse(JSON.stringify(episode)) as Episode;
    const overrideMap = new Map<string, Record<number, PerTrackModifier>>();

    for (const [stableKey, mod] of Object.entries(rawOverrides)) {
        const lastColon = stableKey.lastIndexOf(':');
        if (lastColon <= 0) continue;
        const mapKey = stableKey.slice(0, lastColon);
        const originalIdx = Number(stableKey.slice(lastColon + 1));
        if (!mod || Object.keys(mod).length === 0) continue;
        let fileMap = overrideMap.get(mapKey);
        if (!fileMap) {
            fileMap = {};
            overrideMap.set(mapKey, fileMap);
        }
        fileMap[originalIdx] = mod;
    }

    if (overrideMap.size > 0) {
        for (const sourceEntry of merged.sources) {
            const sourcePath = resolveSourcePath(sourceEntry.file.directory, sourceEntry.file.name);
            const fileOverrides = overrideMap.get(sourcePath);
            if (fileOverrides) {
                const existing = sourceEntry.perTrackModifiers as Record<number, PerTrackModifier> | undefined;
                sourceEntry.perTrackModifiers = { ...existing, ...fileOverrides } as Episode['sources'][0]['perTrackModifiers'];
            }
        }
    }

    return merged;
}

export const useEpisodeQueueStore = defineStore('episodeQueue', () => {
    // ─── Processing state ───────────────────────────────────────
    const episodeProgress = ref<Map<string, EpisodeProgress>>(new Map());
    const isProcessing = ref(false);
    const processingQueue = ref<string[]>([]);
    const currentEpisodeId = ref<string | null>(null);
    const abortControllers = ref<Map<string, AbortController>>(new Map());
    const projectStore = useProjectStore();
    /** Map of processId -> originating projectId so in-flight progress updates remain attributed correctly. */
    const processProject = ref<Map<string, string>>(new Map());

    // ─── Computed ───────────────────────────────────────────────

    const hasActiveProcessing = computed(() => {
        const pid = projectStore.currentProject?.id ?? '__global';
        return Array.from(episodeProgress.value.entries())
            .filter(([k]) => k.startsWith(`${pid}::`))
            .some(([, p]) => p.status === 'preprocessing' || p.status === 'muxing');
    });

    const completedCount = computed(() => {
        const pid = projectStore.currentProject?.id ?? '__global';
        return Array.from(episodeProgress.value.entries())
            .filter(([k]) => k.startsWith(`${pid}::`))
            .filter(([, p]) => p.status === 'completed').length;
    });

    const errorCount = computed(() => {
        const pid = projectStore.currentProject?.id ?? '__global';
        return Array.from(episodeProgress.value.entries())
            .filter(([k]) => k.startsWith(`${pid}::`))
            .filter(([, p]) => p.status === 'error').length;
    });

    const totalCount = computed(() => {
        const pid = projectStore.currentProject?.id ?? '__global';
        return Array.from(episodeProgress.value.keys()).filter(k => k.startsWith(`${pid}::`)).length;
    });

    /**
     * Human-readable reason the UI is locked, or empty string if not locked.
     * Components can show this in tooltips on disabled controls.
     */
    const lockReason = computed(() => {
        if (!hasActiveProcessing.value) return '';
        return 'Muxing in progress — stop all muxing first';
    });

    // ─── Actions ─────────────────────────────────────────────────

    // Key used when reading progress from the UI — always scope to the currently
    // active project so other projects' in-flight work does not surface here.
    function progressKeyForRead(episodeId: string) {
        const currentPid = projectStore.currentProject?.id ?? '__global';
        return `${currentPid}::${episodeId}`;
    }

    // Key used when writing/updating progress (from muxer callbacks). Prefer the
    // recorded originating project for this process so in-flight updates are
    // attributed to the project that started the run regardless of navigation.
    function progressKeyForWrite(episodeId: string) {
        const recorded = processProject.value.get(episodeId);
        const pid = recorded ?? projectStore.currentProject?.id ?? '__global';
        return `${pid}::${episodeId}`;
    }

    function getProgress(episodeId: string): EpisodeProgress {
        const key = progressKeyForRead(episodeId);
        return episodeProgress.value.get(key) ?? {
            status: 'idle',
            progress: 0,
            currentStep: '',
        };
    }

    function setProgress(episodeId: string, progress: Partial<EpisodeProgress>) {
        // When updating, always write to the originating project's bucket so
        // in-flight progress persists with that project.
        const writeKey = progressKeyForWrite(episodeId);
        const current = episodeProgress.value.get(writeKey) ?? { status: 'idle', progress: 0, currentStep: '' };
        episodeProgress.value.set(writeKey, { ...current, ...progress });
    }

    function clearProgress(episodeId: string) {
        // Remove any progress entries for the current project and the recorded
        // project's bucket, if different.
        const readKey = progressKeyForRead(episodeId);
        const writeKey = progressKeyForWrite(episodeId);
        episodeProgress.value.delete(readKey);
        if (writeKey !== readKey) episodeProgress.value.delete(writeKey);
        abortControllers.value.delete(episodeId);
        processProject.value.delete(episodeId);
    }

    function clearAllProgress() {
        // Abort any active processing via the preload bridge
        for (const id of abortControllers.value.keys()) {
            preloadAbortProcessing(id);
        }
        abortControllers.value = new Map();
        episodeProgress.value = new Map();
        processingQueue.value = [];
        currentEpisodeId.value = null;
        processProject.value = new Map();
        isProcessing.value = false;
    }

    /**
     * Reset a single episode's processing state so it can be muxed again.
     * Clears the in-memory progress entry (and aborts any in-flight mux for
     * this episode). Does NOT delete the output file — re-muxing without
     * overwrite will skip if the file already exists.
     */
    function resetEpisode(episodeId: string) {
        // Abort any active processing for this episode via the preload bridge.
        if (abortControllers.value.has(episodeId)) {
            preloadAbortProcessing(episodeId);
        }
        clearProgress(episodeId);
        dequeue(episodeId);

        if (currentEpisodeId.value === episodeId) {
            currentEpisodeId.value = null;
        }

        if (processingQueue.value.length === 0) {
            isProcessing.value = false;
        }
    }

    /**
     * Reset an episode and immediately start muxing it again with overwrite
     * enabled for this single run only. The project's per-file overwrite
     * setting is left untouched.
     */
    function restartEpisode(episodeId: string, episodeData?: Episode) {
        resetEpisode(episodeId);
        if (!episodeData) {
            startProcessing(episodeId, episodeData);
            return;
        }
        // Force overwrite for this run only — do not mutate project data.
        const withOverwrite = JSON.parse(JSON.stringify(episodeData)) as Episode;
        withOverwrite.file.overwrite = true;
        startProcessing(episodeId, withOverwrite);
    }

    // ─── Queue management ───────────────────────────────────────

    function enqueue(episodeIds: string[]) {
        for (const id of episodeIds) {
            if (!processingQueue.value.includes(id)) {
                processingQueue.value.push(id);
            }
            const progress = getProgress(id);
            if (progress.status === 'idle' || progress.status === 'error') {
                setProgress(id, { status: 'pending' as ProcessingStatus, progress: 0, currentStep: '' });
            }
        }
    }

    function dequeue(episodeId: string) {
        processingQueue.value = processingQueue.value.filter((id) => id !== episodeId);
    }

    // ─── Processing control ──────────────────────────────────────

    /**
     * Start processing a single episode using the real muxer.
     * The muxer is created on-demand, runs preprocessing + mux + post-processing,
     * then is disposed immediately. No native resources are held after completion.
     */
    async function startProcessing(
        episodeId: string,
        episodeData?: Episode,
    ) {
        const existing = getProgress(episodeId);
        if (existing.status === 'preprocessing' || existing.status === 'muxing') {
            return; // Already processing
        }

        setProgress(episodeId, {
            status: 'preprocessing',
            progress: 0,
            currentStep: 'Initializing...',
            elapsedMs: 0,
            pps: 0,
            estimatedRemainingMs: undefined,
            totalTimecode: undefined,
            totalPacketsWritten: undefined,
            error: undefined,
        });
        currentEpisodeId.value = episodeId;
        isProcessing.value = true;

        const ac = new AbortController();
        abortControllers.value.set(episodeId, ac);
        if (!episodeData) {
            setProgress(episodeId, {
                status: 'error',
                progress: 0,
                currentStep: 'No episode data provided',
                error: 'Episode data is required to process. Call startProcessing with episodeData.',
            });
            finishEpisode(episodeId);
            return;
        }

        // Serialize to JSON-safe format before crossing the context bridge.
        const serializedEpisode = JSON.parse(
            JSON.stringify(episodeData, (_key, val) =>
                val instanceof RegExp ? val.toString() : val,
            ),
        ) as Episode;

        // Get queue track overrides from the project store and merge them into
        // the episode BEFORE IPC — the worker receives a fully-resolved episode.
        const projectStore = useProjectStore();
        const rawQueueOverrides = projectStore.currentProject?.queueTrackOverrides?.[episodeId];
        const queueOverrides = rawQueueOverrides
            ? JSON.parse(JSON.stringify(rawQueueOverrides, (_key, val) =>
                val instanceof RegExp ? val.toString() : val,
            )) as Record<string, PerTrackModifier>
            : undefined;
        const episodeWithOverrides = mergeQueueOverrides(serializedEpisode, queueOverrides);

        // Record the originating project id for this process so subsequent
        // progress updates remain attributed correctly even if the user
        // navigates to another project before the run completes.
        const originatingProjectId = projectStore.currentProject?.id ?? '__global';
        processProject.value.set(episodeId, originatingProjectId);

        try {
            await processEpisode(
                episodeWithOverrides,
                buildEpisodeListeners(episodeId),
                { processId: episodeId },
            );
        } catch (err: unknown) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                setProgress(episodeId, {
                    status: 'idle',
                    progress: 0,
                    currentStep: 'Cancelled',
                });
                finishEpisode(episodeId);
                return;
            }
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error('[EpisodeQueue] Failed to start episode:', { episodeId, error: errMsg, queueOverridesKeys: queueOverrides ? Object.keys(queueOverrides) : [] });
            setProgress(episodeId, {
                status: 'error',
                progress: 0,
                currentStep: 'Error',
                error: errMsg,
            });
            finishEpisode(episodeId);
        }

        const finalProgress = getProgress(episodeId);
        if (finalProgress.status === 'completed') {
            finishEpisode(episodeId);
        }
    }

    /**
     * Build per-episode IPC listeners (started/progress/complete/error/skipped/cancelled)
     * that update the store's progress state. Shared by single and batch paths.
     */
    function buildEpisodeListeners(episodeId: string): {
        onMuxStarted: () => void;
        onMuxProgress: (snapshot: MuxSnapshot) => void;
        onMuxComplete: (snapshot: MuxSnapshot) => void;
        onMuxError: (payload: MuxErrorPayload | MuxSnapshot) => void;
        onSkipped: (reason: string) => void;
        onCancelled: () => void;
    } {
        return {
            onMuxStarted: () => {
                setProgress(episodeId, {
                    status: 'preprocessing',
                    progress: 0,
                    currentStep: 'Initializing...',
                    elapsedMs: 0,
                    pps: 0,
                });
            },
            onMuxProgress: (snapshot: MuxSnapshot) => {
                const progress = Math.min(100, Math.max(0, snapshot.totalPercent));
                const status: ProcessingStatus = snapshot.phase === 'complete'
                    ? 'completed'
                    : snapshot.phase === 'error'
                        ? 'error'
                        : 'muxing';
                const step = computeCurrentStep(status, progress);

                // Build per-track progress from snapshot.streams
                const trackProgress: Record<number, TrackProgress> = {};
                if (snapshot.streams) {
                    for (const [, ss] of Object.entries(snapshot.streams)) {
                        const s = ss as { outputIndex: number; packetsWritten: number; percent: number; timecode?: string; codecType?: string };
                        trackProgress[s.outputIndex] = {
                            packetsWritten: s.packetsWritten ?? 0,
                            percent: s.percent ?? -1,
                            packetsPerSecond: progress > 0 && snapshot.elapsedMs > 0
                                ? Math.round((s.packetsWritten ?? 0) / (snapshot.elapsedMs / 1000))
                                : 0,
                        };
                    }
                }

                setProgress(episodeId, {
                    status,
                    progress,
                    currentStep: step,
                    elapsedMs: snapshot.elapsedMs,
                    pps: snapshot.pps,
                    estimatedRemainingMs: snapshot.estimatedRemainingMs,
                    totalTimecode: snapshot.totalTimecode,
                    totalPacketsWritten: snapshot.totalPacketsWritten,
                    error: snapshot.error,
                    trackProgress,
                });
            },
            onMuxComplete: (snapshot: MuxSnapshot) => {
                setProgress(episodeId, {
                    status: 'completed',
                    progress: 100,
                    currentStep: 'Completed',
                    elapsedMs: snapshot.elapsedMs,
                    pps: snapshot.pps,
                    totalTimecode: snapshot.totalTimecode,
                    totalPacketsWritten: snapshot.totalPacketsWritten,
                    estimatedRemainingMs: 0,
                    error: undefined,
                });
            },
            onMuxError: (payload: MuxErrorPayload | MuxSnapshot) => {
                const snapshot = 'snapshot' in payload ? payload.snapshot : payload;
                const message = 'message' in payload ? payload.message : undefined;
                const totalPercent = typeof snapshot.totalPercent === 'number' && Number.isFinite(snapshot.totalPercent)
                    ? snapshot.totalPercent
                    : 0;
                setProgress(episodeId, {
                    status: 'error',
                    progress: Math.min(100, Math.max(0, totalPercent)),
                    currentStep: 'Mux error',
                    error: message ?? snapshot.error ?? 'Unknown mux error',
                    elapsedMs: snapshot.elapsedMs,
                    pps: snapshot.pps,
                });
                finishEpisode(episodeId);
            },
            onSkipped: (reason: string) => {
                setProgress(episodeId, {
                    status: 'skipped',
                    progress: 0,
                    currentStep: reason,
                    error: undefined,
                });
                finishEpisode(episodeId);
            },
            onCancelled: () => {
                setProgress(episodeId, {
                    status: 'idle',
                    progress: 0,
                    currentStep: 'Cancelled',
                    elapsedMs: undefined,
                    pps: undefined,
                    estimatedRemainingMs: undefined,
                    totalTimecode: undefined,
                    totalPacketsWritten: undefined,
                    error: undefined,
                });
                finishEpisode(episodeId);
            },
        };
    }

    /**
     * Internal helper to clean up after an episode finishes processing.
     */
    function finishEpisode(episodeId: string) {
        dequeue(episodeId);
        abortControllers.value.delete(episodeId);
        processProject.value.delete(episodeId);

        if (currentEpisodeId.value === episodeId) {
            currentEpisodeId.value = null;
        }

        if (processingQueue.value.length === 0) {
            isProcessing.value = false;
        }
    }

    async function startBatchProcessing(episodeIds: string[], episodesData?: Map<string, Episode>) {
        // Filter out episodes that are already being processed
        const validIds = episodeIds.filter(
            (id) => {
                const p = getProgress(id);
                return p.status === 'idle' || p.status === 'pending' || p.status === 'error';
            },
        );

        if (validIds.length === 0) return;

        enqueue(validIds);
        isProcessing.value = true;
        currentEpisodeId.value = null; // No single "current" in concurrent mode

        const cpuCount = getCpuCount();
        const settings = await getSettings();
        const configured = settings.muxingConcurrency;
        const concurrency = configured !== undefined && configured > 0
            ? Math.min(configured, cpuCount)
            : Math.max(1, cpuCount - 1);

        // Prepare per-episode jobs: serialize + merge queue overrides BEFORE IPC
        // so the worker receives a fully-resolved episode.
        const projectStore = useProjectStore();
        const originatingProjectId = projectStore.currentProject?.id ?? '__global';
        const jobs: {
            episode: Episode;
            processId: string;
            listeners: ReturnType<typeof buildEpisodeListeners>;
        }[] = [];

        for (const id of validIds) {
            const episodeData = episodesData?.get(id);
            if (!episodeData) {
                setProgress(id, {
                    status: 'error',
                    progress: 0,
                    currentStep: 'No episode data provided',
                    error: 'Episode data is required to process.',
                });
                finishEpisode(id);
                continue;
            }

            const serialized = JSON.parse(
                JSON.stringify(episodeData, (_key, val) =>
                    val instanceof RegExp ? val.toString() : val,
                ),
            ) as Episode;

            const rawOverrides = projectStore.currentProject?.queueTrackOverrides?.[id];
            const queueOverrides = rawOverrides
                ? JSON.parse(JSON.stringify(rawOverrides, (_key, val) =>
                    val instanceof RegExp ? val.toString() : val,
                )) as Record<string, PerTrackModifier>
                : undefined;

            jobs.push({
                episode: mergeQueueOverrides(serialized, queueOverrides),
                processId: id,
                listeners: buildEpisodeListeners(id),
            });
            // Record the originating project for this job id so progress updates
            // during the batch remain attributed correctly.
            processProject.value.set(id, originatingProjectId);
        }

        if (jobs.length === 0) {
            isProcessing.value = false;
            currentEpisodeId.value = null;
            return;
        }

        try {
            await processBatch(jobs, concurrency);
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error('[EpisodeQueue] Batch processing failed:', { error: errMsg, jobs: jobs.length });
            for (const job of jobs) {
                const p = getProgress(job.processId);
                if (p.status !== 'completed' && p.status !== 'skipped' && p.status !== 'error') {
                    setProgress(job.processId, {
                        status: 'error',
                        progress: p.progress ?? 0,
                        currentStep: 'Error',
                        error: errMsg,
                    });
                    finishEpisode(job.processId);
                }
            }
        }

        // Safety: finishEpisode already manages isProcessing via queue emptiness,
        // but ensure it's false if somehow all tasks silently failed.
        if (processingQueue.value.length === 0) {
            isProcessing.value = false;
        }
        currentEpisodeId.value = null;
    }

    function stopProcessing(episodeId: string) {
        // Abort via the preload bridge (uses internal AbortController, not the
        // non-cloneable AbortSignal which would fail in contextBridge)
        preloadAbortProcessing(episodeId);
        abortControllers.value.delete(episodeId);
        processProject.value.delete(episodeId);

        setProgress(episodeId, {
            status: 'idle',
            progress: 0,
            currentStep: '',
            elapsedMs: undefined,
            pps: undefined,
            estimatedRemainingMs: undefined,
            totalTimecode: undefined,
            totalPacketsWritten: undefined,
            error: undefined,
        });
        dequeue(episodeId);

        if (currentEpisodeId.value === episodeId) {
            currentEpisodeId.value = null;
        }

        if (processingQueue.value.length === 0) {
            isProcessing.value = false;
        }
    }

    function stopAllProcessing() {
        // Abort all active muxers via the preload bridge
        for (const id of processingQueue.value) {
            preloadAbortProcessing(id);
        }
        abortControllers.value = new Map();

        for (const id of processingQueue.value) {
            setProgress(id, {
                status: 'idle',
                progress: 0,
                currentStep: '',
                elapsedMs: undefined,
                pps: undefined,
                estimatedRemainingMs: undefined,
                totalTimecode: undefined,
                totalPacketsWritten: undefined,
                error: undefined,
            });
        }
        processingQueue.value = [];
        currentEpisodeId.value = null;
        isProcessing.value = false;
        processProject.value = new Map();
    }

    return {
        // State
        episodeProgress,
        isProcessing,
        processingQueue,
        currentEpisodeId,
        abortControllers,

        // Computed
        hasActiveProcessing,
        lockReason,
        completedCount,
        errorCount,
        totalCount,

        // Actions
        getProgress,
        setProgress,
        clearProgress,
        clearAllProgress,
        resetEpisode,
        restartEpisode,
        enqueue,
        dequeue,
        startProcessing,
        startBatchProcessing,
        stopProcessing,
        stopAllProcessing,
    };
});
