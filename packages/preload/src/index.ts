import { sha256sum } from './nodeCrypto.js';
import { versions } from './versions.js';
import { createDefaultProjectData, DEFAULT_RENAME_TEMPLATE, DEFAULT_RENAME_FIELD_CONFIG } from './types.js';
import type { ProjectData } from './types.js';
import {
    listProjects as listProjectsFs,
    loadProject as loadProjectFs,
    saveProject as saveProjectFs,
    removeProject as removeProjectFs,
} from './types.js';
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, parse } from 'node:path';
import { cpus } from 'node:os';
import {
    type AppSettings,
    DEFAULT_SETTINGS,
} from '@app/settings';
import {
    type TmdbSearchResult,
    type TmdbSeriesCache,
    searchSeries as tmdbSearchSeries,
    getSeriesDetails as tmdbGetSeriesDetails,
} from '@app/tmdb';

// Types from @app/muxer used locally in function signatures.
// Only imported once — avoids _-prefix workaround.
import type {
    MuxSnapshot,
    Episode,
    StreamInfo,
    MuxerModel,
    CodecConstants,
    CodecEntry,
} from '@app/muxer';

import { getStreamTracks } from '@app/mediainfo';

// ─── Types ────────────────────────────────────────────────────────

export type { ProjectData, ProjectListItem, FieldConfig, MuxerMuxOptions, MuxerSource, DefaultProjectOptions } from './types.js';
// Re-export everything consumers need — includes both locally-used types and pure passthrough re-exports.
// Types only re-exported (TrackComparison, Multiplexer, etc.) are never imported locally,
// avoiding TS6133 "declared but never used" warnings.
export type {
    MuxSnapshot,
    Episode,
    TrackComparison,
    PerTrackModifier,
    MuxerModel,
    Multiplexer,
    NativeMultiplexer,
    FFmpegMultiplexer,
    StreamInfo,
    CodecConstants,
    CodecEntry,
} from '@app/muxer';
export { createDefaultProjectData, DEFAULT_RENAME_TEMPLATE, DEFAULT_RENAME_FIELD_CONFIG };

import { ipcRenderer } from 'electron';

/**
 * Build a MuxerModel (simulated) for the given episode via IPC.
 */
export async function buildMuxerModel(episode: Episode): Promise<MuxerModel> {
    return ipcRenderer.invoke('muxer:buildMuxerModel', episode) as Promise<MuxerModel>;
}

/** Register a one-style IPC listener for muxer events, auto-cleaned on completion. */
function onMuxEvent<T>(
    channel: string,
    processId: string,
    handler: (data: T) => void,
    cleanup: (() => void)[],
): void {
    const cb = (_event: unknown, data: T) => handler(data);
    ipcRenderer.on(`muxer:${channel}:${processId}`, cb);
    cleanup.push(() => ipcRenderer.removeListener(`muxer:${channel}:${processId}`, cb));
}

/**
 * Mux an episode with queue track overrides via IPC.
 * The episode should already have any queue overrides merged into its
 * per-track modifiers by the caller (renderer). The main process runs the
 * job in a dedicated worker thread via the coordinator.
 */
export interface MuxErrorPayload {
    readonly message: string;
    readonly snapshot: MuxSnapshot;
}

export async function processEpisode(
    episode: Episode,
    listeners?: {
        onMuxStarted?: () => void;
        onMuxProgress?: (snapshot: MuxSnapshot) => void;
        onMuxComplete?: (snapshot: MuxSnapshot) => void;
        onMuxError?: (payload: MuxErrorPayload | MuxSnapshot) => void;
        onSkipped?: (reason: string) => void;
        onCancelled?: () => void;
    },
    options?: { processId?: string },
): Promise<string | undefined> {
    const processId = options?.processId ?? crypto.randomUUID();

    // Wire up IPC event listeners before invoking
    const cleanup: (() => void)[] = [];

    if (listeners?.onMuxStarted) onMuxEvent('started', processId, listeners.onMuxStarted, cleanup);
    if (listeners?.onMuxProgress) onMuxEvent('progress', processId, listeners.onMuxProgress, cleanup);
    if (listeners?.onMuxComplete) onMuxEvent('complete', processId, listeners.onMuxComplete, cleanup);
    if (listeners?.onMuxError) onMuxEvent('error', processId, listeners.onMuxError, cleanup);
    if (listeners?.onSkipped) onMuxEvent<{ reason: string }>('skipped', processId, (data) => listeners.onSkipped!(data.reason), cleanup);
    if (listeners?.onCancelled) onMuxEvent('cancelled', processId, listeners.onCancelled, cleanup);

    try {
        return await ipcRenderer.invoke(
            'muxer:processEpisode',
            episode,
            processId,
        ) as string | undefined;
    } finally {
        for (const c of cleanup) c();
    }
}

/** Abort processing for a given session ID via IPC. */
export function abortProcessing(processId: string) {
    ipcRenderer.invoke('muxer:abortProcessing', processId);
}

/**
 * Mux a batch of episodes via IPC, each in its own worker thread managed by
 * the main-process coordinator. Resolves when all jobs finish.
 *
 * Per-job listeners are wired to the same `muxer:${channel}:${processId}`
 * channels as processEpisode, and cleaned up when the batch resolves.
 */
export async function processBatch(
    jobs: {
        episode: Episode;
        processId: string;
        listeners?: {
            onMuxStarted?: () => void;
            onMuxProgress?: (snapshot: MuxSnapshot) => void;
            onMuxComplete?: (snapshot: MuxSnapshot) => void;
            onMuxError?: (payload: MuxErrorPayload | MuxSnapshot) => void;
            onSkipped?: (reason: string) => void;
            onCancelled?: () => void;
        };
    }[],
    concurrency: number,
): Promise<void> {
    const cleanup: (() => void)[] = [];

    for (const job of jobs) {
        const { processId, listeners } = job;
        if (listeners?.onMuxStarted) onMuxEvent('started', processId, listeners.onMuxStarted, cleanup);
        if (listeners?.onMuxProgress) onMuxEvent('progress', processId, listeners.onMuxProgress, cleanup);
        if (listeners?.onMuxComplete) onMuxEvent('complete', processId, listeners.onMuxComplete, cleanup);
        if (listeners?.onMuxError) onMuxEvent('error', processId, listeners.onMuxError, cleanup);
        if (listeners?.onSkipped) onMuxEvent<{ reason: string }>('skipped', processId, (data) => listeners.onSkipped!(data.reason), cleanup);
        if (listeners?.onCancelled) onMuxEvent('cancelled', processId, listeners.onCancelled, cleanup);
    }

    try {
        await ipcRenderer.invoke(
            'muxer:processBatch',
            jobs.map(({ episode, processId }) => ({ episode, processId })),
            concurrency,
        );
    } finally {
        for (const c of cleanup) c();
    }
}

/** Get the number of logical CPU cores for dynamic concurrency limits. */
export function getCpuCount(): number {
    return cpus().length;
}

export { sha256sum, versions, getStreamTracks, readdirSync, join };

/** All known AV_DISPOSITION_* flag values — fetched via IPC from main process. */
export async function getAllDispositions(): Promise<number[]> {
    return ipcRenderer.invoke('muxer:getAllDispositions') as Promise<number[]>;
}

/** Codec constants — fetched via IPC from main process. */
export async function getCodecConstants(): Promise<CodecConstants> {
    return ipcRenderer.invoke('muxer:getCodecConstants') as Promise<CodecConstants>;
}

/** Codec entry list — fetched via IPC from main process. */
export async function getCodecEntryList(): Promise<CodecEntry[]> {
    return ipcRenderer.invoke('muxer:getCodecEntryList') as Promise<CodecEntry[]>;
}

/** Demux streams from a file — via IPC to main process. */
export async function demuxStreams(filePath: string): Promise<StreamInfo[]> {
    return ipcRenderer.invoke('muxer:demuxStreams', filePath) as Promise<StreamInfo[]>;
}

/** Clear the probe cache — via IPC to main process. */
export async function clearProbeCache(): Promise<void> {
    return ipcRenderer.invoke('muxer:clearProbeCache') as Promise<void>;
}

let _userDataPath: string | null = null;

async function getUserDataPath(): Promise<string> {
    if (!_userDataPath) {
        _userDataPath = await ipcRenderer.invoke('app:getUserDataPath') as string;
    }
    return _userDataPath;
}

// ─── Projects ────────────────────────────────────────────────

export async function listProjects() {
    const userDataPath = await getUserDataPath();
    return listProjectsFs(userDataPath);
}

export async function loadProject(id: string) {
    const userDataPath = await getUserDataPath();
    return loadProjectFs(userDataPath, id);
}

export async function saveProject(payload: { data: ProjectData; travels: unknown }) {
    const userDataPath = await getUserDataPath();
    return saveProjectFs(userDataPath, payload);
}

export async function removeProject(id: string) {
    const userDataPath = await getUserDataPath();
    return removeProjectFs(userDataPath, id);
}

// ─── Dialog ──────────────────────────────────────────────────

export async function openDirectoryDialog(defaultPath?: string): Promise<string | undefined> {
    return ipcRenderer.invoke('dialog:openDirectory', defaultPath) as Promise<string | undefined>;
}

export function showItemInFolder(path: string): void {
    ipcRenderer.invoke('shell:showItemInFolder', path);
}

// ─── File listing (filters out directories) ─────────────────

export function listFiles(dir: string): string[] {
    try {
        return readdirSync(dir).filter((name) => {
            try {
                return statSync(join(dir, name)).isFile();
            } catch {
                return false;
            }
        });
    } catch {
        return [];
    }
}

// ─── Settings ────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
    const userDataPath = await getUserDataPath();
    const settingsPath = join(userDataPath, 'settings.json');
    try {
        const raw = readFileSync(settingsPath, 'utf-8');
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as AppSettings;
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    const current = await getSettings();
    const updated: AppSettings = { ...current, ...settings };
    const userDataPath = await getUserDataPath();
    const settingsPath = join(userDataPath, 'settings.json');
    mkdirSync(userDataPath, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(updated, null, 2));
    return updated;
}

// ─── TMDB ────────────────────────────────────────────────────

async function getTmdbToken(): Promise<string | undefined> {
    const settings = await getSettings();
    return settings.tmdbAccessToken || undefined;
}

export async function searchTmdbSeries(query: string): Promise<TmdbSearchResult[]> {
    const token = await getTmdbToken();
    return tmdbSearchSeries(query, token);
}

export async function getTmdbSeriesDetails(seriesId: number): Promise<TmdbSeriesCache> {
    const token = await getTmdbToken();
    return tmdbGetSeriesDetails(seriesId, token);
}

export async function getCachedTmdbSeries(seriesId: number): Promise<TmdbSeriesCache | null> {
    const userDataPath = await getUserDataPath();
    const cachePath = join(userDataPath, 'tmdb-cache', `${seriesId}.json`);
    if (!existsSync(cachePath)) return null;
    try {
        return JSON.parse(readFileSync(cachePath, 'utf-8')) as TmdbSeriesCache;
    } catch {
        return null;
    }
}

export async function cacheTmdbSeries(seriesId: number, data: TmdbSeriesCache): Promise<void> {
    const userDataPath = await getUserDataPath();
    const cacheDir = join(userDataPath, 'tmdb-cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, `${seriesId}.json`), JSON.stringify(data, null, 2));
}

// ─── Presets ─────────────────────────────────────────────────

export interface PresetData {
    name: string;
    match: Record<string, unknown>;
    modify?: Record<string, unknown>;
    preprocess?: Record<string, unknown>;
    streamType: string;
}

export interface PresetMeta {
    name: string;
    streamType: string;
    modifiedAt: string;
}

function getPresetsDir(userDataPath: string, streamType: string): string {
    return join(userDataPath, 'presets', streamType);
}

function sanitizePresetName(name: string): string {
    // Replace characters that are problematic in filenames
    return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'untitled';
}

export async function listPresets(streamType: string): Promise<PresetMeta[]> {
    const userDataPath = await getUserDataPath();
    const dir = getPresetsDir(userDataPath, streamType);
    mkdirSync(dir, { recursive: true });
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    const presets: PresetMeta[] = [];
    for (const file of files) {
        try {
            const filePath = join(dir, file);
            const raw = readFileSync(filePath, 'utf-8');
            const data = JSON.parse(raw) as PresetData;
            const stat = statSync(filePath);
            presets.push({
                name: data.name || parse(file).name,
                streamType: data.streamType || streamType,
                modifiedAt: stat.mtime.toISOString(),
            });
        } catch {
            // Skip corrupted preset files
        }
    }
    return presets;
}

export async function loadPreset(streamType: string, name: string): Promise<PresetData> {
    const userDataPath = await getUserDataPath();
    const dir = getPresetsDir(userDataPath, streamType);
    const sanitized = sanitizePresetName(name);
    const filePath = join(dir, `${sanitized}.json`);
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as PresetData;
    return {
        name: data.name || sanitized,
        match: data.match ?? {},
        modify: data.modify,
        preprocess: data.preprocess,
        streamType: data.streamType || streamType,
    };
}

export async function savePreset(streamType: string, name: string, data: PresetData): Promise<void> {
    const userDataPath = await getUserDataPath();
    const dir = getPresetsDir(userDataPath, streamType);
    mkdirSync(dir, { recursive: true });
    const sanitized = sanitizePresetName(name);
    const filePath = join(dir, `${sanitized}.json`);
    const payload: PresetData = {
        name: data.name || sanitized,
        match: data.match ?? {},
        modify: data.modify,
        preprocess: data.preprocess,
        streamType: streamType,
    };
    writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

export async function deletePreset(streamType: string, name: string): Promise<void> {
    const userDataPath = await getUserDataPath();
    const dir = getPresetsDir(userDataPath, streamType);
    const sanitized = sanitizePresetName(name);
    const filePath = join(dir, `${sanitized}.json`);
    if (existsSync(filePath)) {
        unlinkSync(filePath);
    }
}
