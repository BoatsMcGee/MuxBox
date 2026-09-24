export type EpisodeStatus = 'loading' | 'pending' | 'unassigned' | 'processing' | 'completed' | 'error' | 'skipped';

export interface TrackProgress {
    packetsWritten: number;
    percent: number;
    packetsPerSecond: number;
}

/** IPC-safe simplified progress data derived from MuxSnapshot for the renderer UI. */
export interface MuxProgressData {
    episodeId: string;
    status: 'idle' | 'preprocessing' | 'muxing' | 'completed' | 'error' | 'skipped';
    progress: number;        // 0-100, derived from totalPercent
    currentStep: string;     // Human readable step
    elapsedMs: number;
    pps: number;
    estimatedRemainingMs?: number;
    error?: string;
    totalTimecode?: string;
    totalPacketsWritten?: number;
    /** Per-track progress keyed by output index. */
    trackProgress?: Record<number, TrackProgress>;
}
