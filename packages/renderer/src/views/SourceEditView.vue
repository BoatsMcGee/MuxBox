<script setup lang="ts">
import { ref, onMounted, computed, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { useProjectStore } from '@/stores/useProjectStore';
import { useEpisodeQueueStore } from '@/stores/useEpisodeQueueStore';
import { openDirectoryDialog, listFiles, join, demuxStreams, getCachedTmdbSeries } from '@app/preload';
import type { MuxerSource, ProjectData, StreamInfo } from '@app/preload';
import type { TmdbSeriesCache } from '@app/tmdb';
import { filenameParse } from '@ctrl/video-filename-parser';
import { tryParseRegex } from '@/lib/utils';
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport, ScrollAreaCorner } from 'reka-ui';
import { TabsRoot, TabsList, TabsTrigger, TabsContent } from 'reka-ui';
import { NumberFieldRoot, NumberFieldInput } from 'reka-ui';
import { TooltipRoot, TooltipTrigger, TooltipContent } from 'reka-ui';
import UiInputPrefix from '@/components/ui/ui-input-prefix.vue';
import StreamMatchBuilder from '@/components/source/builder/StreamMatchBuilder.vue';
import StreamMatchPreview from '@/components/source/preview/StreamMatchPreview.vue';
import type { FilePreviewState } from '@/components/source/preview/StreamMatchPreview.vue';
import { matchAllStreamTypes } from '@/lib/stream-match';
import { runConcurrent } from '@/lib/concurrency';
import { X } from '@lucide/vue';

interface StreamItem {
    id: string;
    name?: string;
    match: Record<string, unknown>;
    modify?: Record<string, unknown>;
    preprocess?: Record<string, unknown>;
}

const route = useRoute();
const router = useRouter();
const projectStore = useProjectStore();

const isNew = computed(() => route.name === 'source-new');
const sourceIdx = computed(() => {
    const idx = route.params.sourceIdx;
    return idx != null ? Number(idx) : -1;
});

const directory = ref('');
const matchPattern = ref('');
const matchFlags = ref('');
const episodeIndex = ref(1);
const seasonIndex = ref<number | undefined>(undefined);
const seasonOverride = ref<number | null>(null);
/** Whether output filenames inherit source filenames. Global per source (not per-episode). */
const inheritFileName = ref(true);
/** Chapter delay template (ms) applied to each episode when using "Copy Chapters". */
const chapterDelay = ref(0);
const episodeOffset = ref(0);

// ─── TMDB data ─────────────────────────────────────────────

const tmdbSeries = ref<TmdbSeriesCache | null>(null);

// ─── Per-file episode computation ─────────────────────────

interface FileEpisodeInfo {
    season: number;
    episode: number;
    episodeName?: string;
}

/** Extract season/episode from a filename.
 *
 * Priority (highest to lowest):
 *   1. Per-file badge overrides (applied in StreamMatchPreview)
 *   2. Global Season Override + Episode Offset (applied in perFileEpisodeInfo computed)
 *   3. Match Pattern with capture groups (below)
 *   4. @ctrl/video-filename-parser fallback (below)
 */
function extractEpisodeFromFilename(file: string): { season: number; episode: number } | null {
    // Priority 3: Match Pattern with capture groups
    if (matchPattern.value) {
        const flags = matchFlags.value || undefined;
        const regex = tryParseRegex(matchPattern.value, flags);
        if (regex) {
            const matchResult = file.match(regex);
            if (matchResult) {
                let episode: number | undefined;
                let season: number | undefined;

                const episodeStr = matchResult[episodeIndex.value];
                if (episodeStr !== undefined) {
                    const parsed = parseInt(episodeStr, 10);
                    if (!isNaN(parsed)) episode = parsed;
                }
                if (seasonIndex.value !== undefined) {
                    const seasonStr = matchResult[seasonIndex.value];
                    if (seasonStr !== undefined) {
                        const parsed = parseInt(seasonStr, 10);
                        if (!isNaN(parsed)) season = parsed;
                    }
                }

                if (episode !== undefined) {
                    return { season: season ?? 1, episode };
                }
            }
        }
    }

    // Priority 4: @ctrl/video-filename-parser fallback
    const parsed = filenameParse(file, true) as {
        seasons?: number[];
        episodeNumbers?: number[];
        title?: string;
    };
    if (parsed?.episodeNumbers?.length && parsed.episodeNumbers[0] != null) {
        const season = parsed.seasons?.[0] ?? 1;
        const episode = parsed.episodeNumbers[0];
        return { season, episode };
    }

    return null;
}

const perFileEpisodeInfo = computed<Record<string, FileEpisodeInfo | null>>(() => {
    const result: Record<string, FileEpisodeInfo | null> = {};
    for (const file of filteredFiles.value) {
        const base = extractEpisodeFromFilename(file);
        if (!base) {
            result[file] = null;
            continue;
        }

        // Priority 2: Global Season Override and Episode Offset
        let season = base.season;
        let episode = base.episode;
        if (seasonOverride.value != null) {
            season = seasonOverride.value;
        }
        episode += episodeOffset.value;

        // Priority 1: Per-file overrides (badge modal) — applied here so episode name
        // lookup uses the effective season/episode the user intends.
        const fileSeasonOverride = perFileSeasonOverride.value[file];
        const fileEpisodeOverride = perFileEpisodeOverride.value[file];
        if (fileSeasonOverride != null) season = fileSeasonOverride;
        if (fileEpisodeOverride != null) episode = fileEpisodeOverride;

        let epName: string | undefined;
        // Priority: episodeNameOverrides > TMDB cache
        const overrideKey = `${season}-${episode}`;
        const override = project.value?.episodeNameOverrides?.[overrideKey];
        if (override !== undefined) {
            epName = override;
        } else {
            const tmdb = tmdbSeries.value;
            if (tmdb) {
                const seasonData = tmdb.seasons[season];
                if (seasonData) {
                    const epData = seasonData.episodes[episode];
                    epName = epData?.name;
                }
            }
        }
        result[file] = { season, episode, episodeName: epName };
    }
    return result;
});

// ─── Per-file episode override state ──────────────────────
const perFileSeasonOverride = ref<Record<string, number | null>>({});
const perFileEpisodeOverride = ref<Record<string, number | null>>({});

// ─── Per-track modifier state ─────────────────────────────
const perTrackModifiersByFile = ref<Record<string, Record<number, Record<string, unknown>>>>({});

function updatePerTrackModifier(file: string, trackIdx: number, field: string, value: unknown) {
    const fileMods = { ...(perTrackModifiersByFile.value[file] ?? {}) };
    const trackMods = { ...(fileMods[trackIdx] ?? {}) };
    if (value === undefined || value === null || value === '') {
        delete trackMods[field];
    } else {
        trackMods[field] = value;
    }
    if (Object.keys(trackMods).length === 0) {
        delete fileMods[trackIdx];
    } else {
        fileMods[trackIdx] = trackMods;
    }
    perTrackModifiersByFile.value = { ...perTrackModifiersByFile.value, ...(Object.keys(fileMods).length > 0 ? { [file]: fileMods } : {}) };
    // Clean up empty file entries
    const cleaned = { ...perTrackModifiersByFile.value };
    if (Object.keys(fileMods).length === 0) delete cleaned[file];
    perTrackModifiersByFile.value = cleaned;
}

function clearPerTrackModifier(file: string, trackIdx: number, field: string) {
    updatePerTrackModifier(file, trackIdx, field, undefined);
}

// Per-file excluded track indices
const excludedTracksByFile = ref<Record<string, Set<number>>>({});

// Per-file source exclusion state
const perFileExcluded = ref<Record<string, boolean>>({});
const excludedFileCount = computed(() => Object.values(perFileExcluded.value).filter(Boolean).length);

const files = ref<string[]>([]);

// Stream match items per type
const videoItems = ref<StreamItem[]>([]);
const audioItems = ref<StreamItem[]>([]);
const subtitleItems = ref<StreamItem[]>([]);
const attachmentItems = ref<StreamItem[]>([]);

// Template refs to the stream match builders so we can flush pending JSON edits on save.
const videoBuilderRef = ref<InstanceType<typeof StreamMatchBuilder> | null>(null);
const audioBuilderRef = ref<InstanceType<typeof StreamMatchBuilder> | null>(null);
const subtitleBuilderRef = ref<InstanceType<typeof StreamMatchBuilder> | null>(null);
const attachmentBuilderRef = ref<InstanceType<typeof StreamMatchBuilder> | null>(null);

/** Flush any pending valid JSON edits in all stream match builders before saving. */
function flushStreamBuilders(): void {
    for (const builder of [videoBuilderRef, audioBuilderRef, subtitleBuilderRef, attachmentBuilderRef]) {
        builder.value?.flush?.();
    }
}

// Active stream configuration tab
const activeStreamTab = ref<'video' | 'audio' | 'subtitle' | 'attachment'>('video');

const project = computed(() => projectStore.currentProject);

// ─── Stream info loading per file ────────────────────────────

/** Tracks loading state per file */
const fileLoadState = ref<Record<string, { loading: boolean; error: boolean }>>({});

/** Cache of StreamInfo arrays per file (keyed by filename) */
const streamInfoCache = ref<Record<string, StreamInfo[]>>({});

/** Total number of files currently being loaded */
const pendingLoadCount = computed(() =>
    Object.values(fileLoadState.value).filter((s) => s.loading).length,
);

/**
 * Load stream info for a single file using node-av and update cache + load state.
 */
async function loadStreamInfoForFile(file: string) {
    fileLoadState.value = {
        ...fileLoadState.value,
        [file]: { loading: true, error: false },
    };

    try {
        const fullPath = join(directory.value, file);
        const infos = await demuxStreams(fullPath);
        streamInfoCache.value = { ...streamInfoCache.value, [file]: infos };
        fileLoadState.value = {
            ...fileLoadState.value,
            [file]: { loading: false, error: false },
        };
    } catch (err) {
        console.error(`Failed to get stream info for ${file}:`, err);
        fileLoadState.value = {
            ...fileLoadState.value,
            [file]: { loading: false, error: true },
        };
    }
}

// ─── File list ────────────────────────────────────────────────

// Whether the regex pattern is invalid (non-empty but fails to parse)
const regexError = computed(() => {
    if (!matchPattern.value) return '';
    const flags = matchFlags.value || undefined;
    const regex = tryParseRegex(matchPattern.value, flags);
    return regex ? '' : 'Invalid regex pattern';
});

// Filter files by match pattern regex
const filteredFiles = computed(() => {
    if (!matchPattern.value) return files.value;
    const flags = matchFlags.value || undefined;
    const regex = tryParseRegex(matchPattern.value, flags);
    if (!regex) return files.value;
    return files.value.filter((f) => regex.test(f));
});

// Toggle a regex pattern flag (i, g, m)
function toggleMatchFlag(flag: string) {
    const flags = matchFlags.value;
    if (flags.includes(flag)) {
        matchFlags.value = flags.replace(flag, '');
    } else {
        matchFlags.value = flags + flag;
    }
}

// ─── Per-file metadata/chapters state ─────────────────────────
// Per-file maps are the single source of truth. There are no global
// inherit flags — bulk buttons copy values into each episode's entry.

const perFileMetadata = ref<Record<string, boolean>>({});
const perFileChapters = ref<Record<string, boolean>>({});
const perFileChapterDelay = ref<Record<string, number>>({});

/** Whether ALL visible files have metadata enabled. */
const allMetadataApplied = computed(() => {
    const fl = filteredFiles.value;
    return fl.length > 0 && fl.every((f) => perFileMetadata.value[f] === true);
});

/** Whether ALL visible files have chapters enabled. */
const allChaptersApplied = computed(() => {
    const fl = filteredFiles.value;
    return fl.length > 0 && fl.every((f) => perFileChapters.value[f] === true);
});

const metadataAppliedCount = computed(() =>
    filteredFiles.value.filter((f) => perFileMetadata.value[f] === true).length,
);

const chaptersAppliedCount = computed(() =>
    filteredFiles.value.filter((f) => perFileChapters.value[f] === true).length,
);

function toggleApplyMetadata() {
    const target = !allMetadataApplied.value;
    const fl = filteredFiles.value;
    const next = { ...perFileMetadata.value };
    for (const f of fl) {
        next[f] = target;
    }
    perFileMetadata.value = next;
}

function toggleApplyChapters() {
    const target = !allChaptersApplied.value;
    const fl = filteredFiles.value;
    const nextCh = { ...perFileChapters.value };
    const nextDelay = { ...perFileChapterDelay.value };
    for (const f of fl) {
        nextCh[f] = target;
        if (target) {
            // Copy the delay template into each episode's Delay input.
            nextDelay[f] = chapterDelay.value;
        }
    }
    perFileChapters.value = nextCh;
    perFileChapterDelay.value = nextDelay;
}

function handleToggleTrackExclude(file: string, trackIdx: number) {
    const set = excludedTracksByFile.value[file] ?? new Set<number>();
    if (set.has(trackIdx)) {
        set.delete(trackIdx);
        if (set.size === 0) {
            delete excludedTracksByFile.value[file];
        }
    } else {
        set.add(trackIdx);
    }
    // Trigger reactivity by reassigning
    excludedTracksByFile.value = { ...excludedTracksByFile.value, [file]: set };
}

/**
 * Version counter incremented whenever stream match items change.
 * Used to invalidate per-file preview caches selectively.
 */
const streamItemsVersion = ref(0);

// Watch all stream item arrays and bump the version counter
watch(
    [videoItems, audioItems, subtitleItems, attachmentItems],
    () => {
        streamItemsVersion.value++;
    },
    { deep: true },
);

/**
 * Per-file preview state cache.
 * Stores the computed FilePreviewState for each file keyed by
 * `${file}::v${version}` so only files whose inputs actually changed
 * get re-computed.
 */
const filePreviewCache = ref<Record<string, FilePreviewState>>({});

/**
 * Maintain the cache: remove stale entries when file lists change,
 * and compute fresh entries for files whose loading/stream data changed.
 */
watch(
    [filteredFiles, fileLoadState, streamInfoCache, streamItemsVersion],
    () => {
        const files = filteredFiles.value;
        const next: Record<string, FilePreviewState> = {};
        const version = streamItemsVersion.value;

        for (const file of files) {
            const state = fileLoadState.value[file];

            // Still loading
            if (!state || state.loading) {
                next[file] = {
                    file,
                    loading: true,
                    error: false,
                    totalStreams: 0,
                    matchedStreams: 0,
                    tracks: [],
                    anyMatched: false,
                };
                continue;
            }

            // Failed to load
            if (state.error) {
                next[file] = {
                    file,
                    loading: false,
                    error: true,
                    totalStreams: 0,
                    matchedStreams: 0,
                    tracks: [],
                    anyMatched: false,
                };
                continue;
            }

            // Check if we have a cache hit for this version
            const cacheKey = `${file}::v${version}`;
            const cached = filePreviewCache.value[cacheKey];
            if (cached) {
                next[file] = cached;
                continue;
            }

            // Loaded - compute match results
            const infos = streamInfoCache.value[file] ?? null;
            const result = matchAllStreamTypes(
                infos,
                videoItems.value,
                audioItems.value,
                subtitleItems.value,
                attachmentItems.value,
            );

            next[file] = {
                file,
                loading: false,
                error: false,
                totalStreams: result.totalStreams,
                matchedStreams: result.matchedStreams,
                tracks: result.tracks,
                anyMatched: result.anyMatched,
            };
        }

        filePreviewCache.value = next;
    },
    { immediate: true },
);

/**
 * Reactive preview states for all filtered files.
 * Reads from the per-file cache which is kept up-to-date by the watcher above.
 * This is a shallow computed that only triggers when the cache ref changes.
 */
const filePreviewStates = computed<FilePreviewState[]>(() => {
    const files = filteredFiles.value;
    const cache = filePreviewCache.value;
    return files.map((file) => cache[file] ?? {
        file,
        loading: true,
        error: false,
        totalStreams: 0,
        matchedStreams: 0,
        tracks: [],
        anyMatched: false,
    });
});

// ─── Lifecycle ────────────────────────────────────────────────

const queueStore = useEpisodeQueueStore();

onBeforeRouteLeave((_to, _from) => {
    if (queueStore.hasActiveProcessing) {
        const answer = window.confirm('Muxing is in progress. Leaving this page now will cancel all active muxing. Continue?');
        if (!answer) {
            return false;
        }
    }
    return true;
});

// Clear caches on unmount to release accumulated stream data
onBeforeUnmount(() => {
    streamInfoCache.value = {};
    fileLoadState.value = {};
    filePreviewCache.value = {};
});

onMounted(() => {
    // Load TMDB series cache (needed for both new and edit modes)
    const pid = project.value?.tmdbSeriesId;
    if (pid != null) {
        getCachedTmdbSeries(pid).then(cached => {
            if (cached) tmdbSeries.value = cached;
        }).catch(() => {});
    }

    // Automatically open the directory picker when adding a new source
    if (isNew.value) {
        pickDirectory();
    }

    if (!isNew.value && sourceIdx.value >= 0) {
        const source = project.value?.sources[sourceIdx.value];
        if (source) {
            directory.value = source.directory;
            if (source.match) {
                // Handle both legacy RegExp objects and new string-based EpisodeMatch format
                const rawRegex = source.match instanceof RegExp
                    ? source.match.toString()
                    : source.match.regex;
                const rawFlags = source.match instanceof RegExp
                    ? ''
                    : (source.match.regexFlags ?? '');

                if (typeof rawRegex === 'string' && rawRegex.startsWith('/')) {
                    // Legacy format: "/pattern/flags" — extract pattern and flags from the string
                    const lastSlash = rawRegex.lastIndexOf('/');
                    matchPattern.value = rawRegex.slice(1, lastSlash);
                    matchFlags.value = rawFlags || rawRegex.slice(lastSlash + 1);
                } else {
                    // New format: plain string pattern (possibly from migration)
                    matchPattern.value = String(rawRegex ?? '');
                    matchFlags.value = rawFlags;
                }

                episodeIndex.value = source.match instanceof RegExp ? 1 : (source.match.episodeIndex ?? 1);
                seasonIndex.value = source.match instanceof RegExp ? undefined : source.match.seasonIndex;
            }
            seasonOverride.value = source.season ?? null;
            inheritFileName.value = source.inheritFileName ?? true;
            chapterDelay.value = 0;
            episodeOffset.value = source.episodeOffset ?? 0;

            // Load per-file metadata and chapters settings
            perFileMetadata.value = { ...((source.perFileMetadata as Record<string, boolean>) ?? {}) };
            perFileChapters.value = { ...((source.perFileChapters as Record<string, boolean>) ?? {}) };
            perFileChapterDelay.value = { ...((source.perFileChapterDelay as Record<string, number>) ?? {}) };

            // Load per-file exclusion state
            perFileExcluded.value = (source.perFileExcluded as Record<string, boolean>) ?? {};

            // Load per-file episode overrides
            perFileSeasonOverride.value = (source.perFileSeasonOverride as Record<string, number | null> | undefined) ?? {};
            perFileEpisodeOverride.value = (source.perFileEpisodeOverride as Record<string, number | null> | undefined) ?? {};

            // Load per-track modifiers
            perTrackModifiersByFile.value = (source.perTrackModifiers as Record<string, Record<number, Record<string, unknown>>> | undefined) ?? {};

            // Load per-file excluded track indices (number[] → Set<number>)
            const rawExcludedTracks = (source.excludedTracks as Record<string, number[]> | undefined) ?? {};
            excludedTracksByFile.value = Object.fromEntries(
                Object.entries(rawExcludedTracks).map(([file, indices]) => [file, new Set(indices)]),
            );

            videoItems.value = (source.video ?? []).map((item) => {
                const raw = item as Record<string, unknown>;
                return {
                    id: crypto.randomUUID(),
                    name: raw.name as string | undefined,
                    match: (raw.match as Record<string, unknown>) ?? {},
                    modify: raw.modify as Record<string, unknown> | undefined,
                    preprocess: raw.preprocess as Record<string, unknown> | undefined,
                };
            });
            audioItems.value = (source.audio ?? []).map((item) => {
                const raw = item as Record<string, unknown>;
                return {
                    id: crypto.randomUUID(),
                    name: raw.name as string | undefined,
                    match: (raw.match as Record<string, unknown>) ?? {},
                    modify: raw.modify as Record<string, unknown> | undefined,
                    preprocess: raw.preprocess as Record<string, unknown> | undefined,
                };
            });
            subtitleItems.value = (source.subtitle ?? []).map((item) => {
                const raw = item as Record<string, unknown>;
                return {
                    id: crypto.randomUUID(),
                    name: raw.name as string | undefined,
                    match: (raw.match as Record<string, unknown>) ?? {},
                    modify: raw.modify as Record<string, unknown> | undefined,
                };
            });
            attachmentItems.value = (source.attachment ?? []).map((item) => {
                const raw = item as Record<string, unknown>;
                return {
                    id: crypto.randomUUID(),
                    name: raw.name as string | undefined,
                    match: (raw.match as Record<string, unknown>) ?? {},
                };
            });

            loadFiles();
        }
    }
});

// ─── Actions ──────────────────────────────────────────────────

async function pickDirectory() {
    const result = await openDirectoryDialog(directory.value || undefined);
    if (result) {
        directory.value = result;
        // Switching directories invalidates per-file state from the previous
        // directory. (loadFiles() intentionally preserves it for re-loads.)
        perFileMetadata.value = {};
        perFileChapters.value = {};
        perFileChapterDelay.value = {};
        perFileExcluded.value = {};
        await loadFiles();
    }
}

/** AbortController for the current loadFiles session. */
let currentProbeAbort: AbortController | undefined;

onBeforeUnmount(() => {
    // Cancel any in-flight probes when navigating away
    currentProbeAbort?.abort();
});

async function loadFiles() {
    if (!directory.value) return;

    // Cancel any previous probes
    currentProbeAbort?.abort();
    const abort = new AbortController();
    currentProbeAbort = abort;

    // Reset state
    files.value = [];
    streamInfoCache.value = {};
    fileLoadState.value = {};

    try {
        const fileList = listFiles(directory.value);
        files.value = fileList;

        // Mark all files as loading immediately
        const initialState: Record<string, { loading: boolean; error: boolean }> = {};
        for (const f of fileList) {
            initialState[f] = { loading: true, error: false };
        }
        fileLoadState.value = initialState;

        // Pre-warm by loading the first file before the batch.
        if (fileList.length > 0) {
            try {
                const firstFile = fileList[0];
                const fullPath = join(directory.value, firstFile);
                const infos = await demuxStreams(fullPath);
                streamInfoCache.value = { ...streamInfoCache.value, [firstFile]: infos };
                fileLoadState.value = {
                    ...fileLoadState.value,
                    [firstFile]: { loading: false, error: false },
                };
            } catch {
                // Fall through to concurrent loading
            }
        }

        // Kick off async stream info loading for remaining files.
        const remainingFiles = fileList.filter((_, i) => i > 0);
        if (remainingFiles.length > 0) {
            runConcurrent(
                remainingFiles,
                (f) => loadStreamInfoForFile(f),
                4,
                abort.signal,
            ).catch(() => {});
        }
    } catch {
        files.value = [];
    }
}

async function handleSave() {
    if (!directory.value) return;

    // Flush any pending valid JSON edits in the stream match builders so the
    // latest filter/modify/preprocess values are captured before building source.
    flushStreamBuilders();

    // Validate regex before saving
    const flags = matchFlags.value || undefined;
    const validRegex = matchPattern.value ? tryParseRegex(matchPattern.value, flags) : undefined;
    if (matchPattern.value && !validRegex) {
        // Invalid regex — form validation should prevent this, but guard anyway
        return;
    }

    // Build source object without explicit undefined values
    // Travels warns when undefined is assigned since JSON persistence removes it
    // Per-file maps are the single source of truth — no global inherit flags.
    const source: Record<string, unknown> = {
        directory: directory.value,
        inheritFileName: inheritFileName.value,
        video: videoItems.value.map((item) => {
            const out: Record<string, unknown> = { match: item.match };
            if (item.name) out.name = item.name;
            if (item.modify && Object.keys(item.modify).length > 0) out.modify = item.modify;
            if (item.preprocess && Object.keys(item.preprocess).length > 0) out.preprocess = item.preprocess;
            return out;
        }),
        audio: audioItems.value.map((item) => {
            const out: Record<string, unknown> = { match: item.match };
            if (item.name) out.name = item.name;
            if (item.modify && Object.keys(item.modify).length > 0) out.modify = item.modify;
            if (item.preprocess && Object.keys(item.preprocess).length > 0) out.preprocess = item.preprocess;
            return out;
        }),
        subtitle: subtitleItems.value.map((item) => {
            const out: Record<string, unknown> = { match: item.match };
            if (item.name) out.name = item.name;
            if (item.modify && Object.keys(item.modify).length > 0) out.modify = item.modify;
            return out;
        }),
        attachment: attachmentItems.value.map((item) => {
            const out: Record<string, unknown> = { match: item.match };
            if (item.name) out.name = item.name;
            return out;
        }),
    };
    // Only include optional fields when they have a value (avoid undefined in travels)
    // Store regex as a plain string (not a RegExp object) to keep Travels state JSON-compatible.
    if (validRegex) {
        source.match = {
            regex: matchPattern.value,
            ...(flags ? { regexFlags: flags } : undefined),
            episodeIndex: episodeIndex.value,
            ...seasonIndex.value !== undefined && { seasonIndex: seasonIndex.value },
        };
    }
    if (episodeOffset.value !== 0) {
        source.episodeOffset = episodeOffset.value;
    }
    if (seasonOverride.value !== null) {
        source.season = seasonOverride.value;
    }
    // Per-file maps are the single source of truth — persist them directly.
    // (No global inheritMetadata / chapters.)
    if (Object.keys(perFileMetadata.value).length > 0) {
        source.perFileMetadata = { ...perFileMetadata.value };
    }
    if (Object.keys(perFileChapters.value).length > 0) {
        source.perFileChapters = { ...perFileChapters.value };
    }
    if (Object.keys(perFileChapterDelay.value).length > 0) {
        source.perFileChapterDelay = { ...perFileChapterDelay.value };
    }
    // Persist per-file exclusion state
    const excludedEntries = Object.entries(perFileExcluded.value).filter(([, v]) => v);
    if (excludedEntries.length > 0) {
        source.perFileExcluded = Object.fromEntries(excludedEntries);
    }
    // Persist per-file excluded track indices (Set<number> → number[])
    const excludedTrackEntries = Object.entries(excludedTracksByFile.value)
        .filter(([, set]) => set.size > 0)
        .map(([file, set]) => [file, [...set]] as const);
    if (excludedTrackEntries.length > 0) {
        source.excludedTracks = Object.fromEntries(excludedTrackEntries);
    }
    // Persist per-file season/episode overrides
    const seasonOverrides = Object.entries(perFileSeasonOverride.value).filter(([, v]) => v != null);
    if (seasonOverrides.length > 0) {
        source.perFileSeasonOverride = Object.fromEntries(seasonOverrides) as Record<string, number>;
    }
    const episodeOverrides = Object.entries(perFileEpisodeOverride.value).filter(([, v]) => v != null);
    if (episodeOverrides.length > 0) {
        source.perFileEpisodeOverride = Object.fromEntries(episodeOverrides) as Record<string, number>;
    }
    // Persist per-track modifiers (clean empty entries)
    const trackMods = perTrackModifiersByFile.value;
    const cleanedTrackMods: Record<string, Record<number, Record<string, unknown>>> = {};
    for (const [file, fileMods] of Object.entries(trackMods)) {
        const cleanFileMods: Record<number, Record<string, unknown>> = {};
        for (const [trackIdxStr, mods] of Object.entries(fileMods)) {
            const trackIdx = Number(trackIdxStr);
            const cleanMods = Object.fromEntries(
                Object.entries(mods).filter(([, v]) => v !== undefined && v !== null && v !== ''),
            );
            if (Object.keys(cleanMods).length > 0) {
                cleanFileMods[trackIdx] = cleanMods;
            }
        }
        if (Object.keys(cleanFileMods).length > 0) {
            cleanedTrackMods[file] = cleanFileMods;
        }
    }
    if (Object.keys(cleanedTrackMods).length > 0) {
        source.perTrackModifiers = cleanedTrackMods;
    }

    projectStore.updateProject((d: ProjectData) => {
        if (isNew.value) {
            d.sources.push(source as unknown as MuxerSource);
        } else if (sourceIdx.value >= 0) {
            d.sources[sourceIdx.value] = source as unknown as MuxerSource;
        }
    });

    router.push({ name: 'project', params: { id: route.params.id as string } });
}

function handleCancel() {
    router.push({ name: 'project', params: { id: route.params.id as string } });
}

function handlePerFileMetadataUpdate(file: string, val: boolean) {
    perFileMetadata.value = { ...perFileMetadata.value, [file]: val };
}

function handlePerFileChaptersUpdate(file: string, val: boolean) {
    perFileChapters.value = { ...perFileChapters.value, [file]: val };
}

function handlePerFileChapterDelayUpdate(file: string, val: number) {
    perFileChapterDelay.value = { ...perFileChapterDelay.value, [file]: val };
}

function handlePerFileSeasonOverride(file: string, val: number | null) {
    perFileSeasonOverride.value = { ...perFileSeasonOverride.value, [file]: val };
}

function handleToggleSourceExclude(file: string) {
    const current = perFileExcluded.value[file] ?? false;
    perFileExcluded.value = { ...perFileExcluded.value, [file]: !current };
}

function handlePerFileEpisodeOverride(file: string, val: number | null) {
    perFileEpisodeOverride.value = { ...perFileEpisodeOverride.value, [file]: val };
}

</script>

<template>
    <div class="flex flex-col min-h-screen">
        <header class="border-b px-4 py-2 flex items-center gap-3">
            <button class="text-sm text-muted-foreground hover:text-foreground shrink-0" @click="handleCancel">
                ← Back
            </button>
            <h1 class="text-base font-semibold shrink-0">
                {{ isNew ? 'Add Source' : 'Edit Source' }}
            </h1>
            <div class="flex-1 flex items-center gap-2 min-w-0">
                <input class="flex-1 px-2 py-1 border rounded-md bg-background text-xs font-mono min-w-0"
                    :value="directory" placeholder="Select a directory..." readonly />
                <button class="px-3 py-1 border rounded-md hover:bg-accent text-xs shrink-0" @click="pickDirectory">
                    Browse
                </button>
            </div>
        </header>

        <main class="flex-1 p-6">
            <div class="max-w-7xl mx-auto">
                <div class="grid grid-cols-1 xl:grid-cols-2 xl:grid-rows-[1fr] gap-6 xl:min-h-0" :class="{ 'xl:h-[calc(100vh-10rem)]': directory }">

                    <!-- Left Column: General Settings + Stream Configuration -->
                    <ScrollAreaRoot class="xl:overflow-hidden xl:flex xl:flex-col" type="auto" :style="{ height: '100%' }">
                        <ScrollAreaViewport class="xl:flex-1 xl:min-h-0">
                            <div class="space-y-6">

                                <!-- General Settings (no header) -->
                                <section v-if="directory" class="rounded-lg border bg-card p-4 space-y-3">
                                    <!-- Row 1: Match Pattern (full width) -->
                                    <div>
                                        <div class="flex items-center gap-2 mb-1">
                                            <label class="text-sm font-medium">Match Pattern</label>
                                            <p v-if="regexError" class="text-xs text-destructive">
                                                {{ regexError }}
                                            </p>
                                            <p v-else-if="matchPattern && filteredFiles.length !== files.length" class="text-xs text-muted-foreground">
                                                {{ filteredFiles.length }}/{{ files.length }} matched
                                            </p>
                                        </div>
                                        <UiInputPrefix v-model="matchPattern" placeholder="e.g. S01E(\d+)" mono
                                            :class="regexError ? 'border-destructive' : ''">
                                            <template #prefix>
                                                <span class="text-sm text-muted-foreground font-mono pl-2 pr-0.5 select-none">/</span>
                                            </template>
                                            <template #suffix>
                                                <span class="text-sm text-muted-foreground font-mono pl-0.5 pr-0.5 select-none">/</span>
                                                <div class="flex gap-0.5 pr-1.5">
                                                    <button v-for="flag in [{ value: 'i', label: 'i', title: 'Case insensitive' }, { value: 'g', label: 'g', title: 'Global' }, { value: 'm', label: 'm', title: 'Multiline' }]"
                                                        :key="flag.value"
                                                        class="px-1 py-0.5 text-xs font-mono border rounded transition-colors"
                                                        :class="matchFlags.includes(flag.value)
                                                            ? 'bg-primary text-primary-foreground border-primary'
                                                            : 'bg-background text-muted-foreground hover:bg-accent border-input'"
                                                        :title="flag.title"
                                                        @click="toggleMatchFlag(flag.value)">
                                                        {{ flag.label }}
                                                    </button>
                                                </div>
                                            </template>
                                        </UiInputPrefix>
                                    </div>

                                    <!-- Row 2: Capture Groups -->
                                    <div v-if="matchPattern" class="grid grid-cols-2 gap-x-3">
                                        <div class="flex flex-col gap-1">
                                            <label class="text-sm font-medium">Season Capture Group</label>
                                            <NumberFieldRoot v-model="seasonIndex" :min="1" class="w-full">
                                                <div class="flex rounded-md border border-input bg-background overflow-hidden focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                                                    <NumberFieldInput
                                                        class="flex-1 min-w-0 bg-transparent outline-none px-2 py-1.5 text-sm tabular-nums text-right placeholder:text-muted-foreground"
                                                        placeholder="—"
                                                    />
                                                </div>
                                            </NumberFieldRoot>
                                        </div>
                                        <div class="flex flex-col gap-1">
                                            <label class="text-sm font-medium">Episode Capture Group</label>
                                            <NumberFieldRoot v-model="episodeIndex" :min="1" class="w-full">
                                                <div class="flex rounded-md border border-input bg-background overflow-hidden focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                                                    <NumberFieldInput
                                                        class="flex-1 min-w-0 bg-transparent outline-none px-2 py-1.5 text-sm tabular-nums text-right placeholder:text-muted-foreground"
                                                        placeholder="1"
                                                    />
                                                </div>
                                            </NumberFieldRoot>
                                        </div>
                                    </div>

                                    <!-- Row 3: Season Override + Episode Offset (compact grid) -->
                                    <div class="grid grid-cols-2 gap-x-3">
                                        <div class="flex flex-col gap-1">
                                            <label class="text-sm font-medium">Season Override</label>
                                            <NumberFieldRoot v-model="seasonOverride" :min="0" :step="1" class="w-full">
                                                <div class="flex rounded-md border border-input bg-background overflow-hidden focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                                                    <NumberFieldInput
                                                        class="flex-1 min-w-0 bg-transparent outline-none px-2 py-1.5 text-sm tabular-nums text-right placeholder:text-muted-foreground"
                                                        placeholder="—"
                                                    />
                                                    <TooltipRoot v-if="seasonOverride != null" :delay-duration="200">
                                                        <TooltipTrigger as-child>
                                                            <button
                                                                type="button"
                                                                tabindex="-1"
                                                                class="flex items-center justify-center px-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                                                @click="seasonOverride = null"
                                                            >
                                                                <X class="w-3 h-3" />
                                                            </button>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                                            Clear
                                                        </TooltipContent>
                                                    </TooltipRoot>
                                                </div>
                                            </NumberFieldRoot>
                                        </div>
                                        <div class="flex flex-col gap-1">
                                            <label class="text-sm font-medium">Episode Offset</label>
                                            <NumberFieldRoot v-model="episodeOffset" :step="1" class="w-full">
                                                <div class="flex rounded-md border border-input bg-background overflow-hidden focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                                                    <NumberFieldInput
                                                        class="flex-1 min-w-0 bg-transparent outline-none px-2 py-1.5 text-sm tabular-nums text-right placeholder:text-muted-foreground"
                                                    />
                                                    <TooltipRoot v-if="episodeOffset !== 0" :delay-duration="200">
                                                        <TooltipTrigger as-child>
                                                            <button
                                                                type="button"
                                                                tabindex="-1"
                                                                class="flex items-center justify-center px-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                                                @click="episodeOffset = 0"
                                                            >
                                                                <X class="w-3 h-3" />
                                                            </button>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                                            Clear
                                                        </TooltipContent>
                                                    </TooltipRoot>
                                                </div>
                                            </NumberFieldRoot>
                                        </div>
                                    </div>

                                    <!-- Row 4: Copy Metadata + Copy Chapters (bulk apply buttons) -->
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <button
                                            type="button"
                                            class="px-3 py-1 border rounded-md text-xs transition-colors"
                                            :class="allMetadataApplied
                                                ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
                                                : 'hover:bg-accent'"
                                            :title="allMetadataApplied ? 'Remove metadata from all episodes' : 'Enable metadata for all episodes'"
                                            @click="toggleApplyMetadata"
                                        >
                                            {{ allMetadataApplied ? `Remove Metadata (${metadataAppliedCount})` : metadataAppliedCount > 0 ? `Copy Metadata (${metadataAppliedCount}/${filteredFiles.length})` : 'Copy Metadata' }}
                                        </button>
                                        <button
                                            type="button"
                                            class="px-3 py-1 border rounded-md text-xs transition-colors"
                                            :class="allChaptersApplied
                                                ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
                                                : 'hover:bg-accent'"
                                            :title="allChaptersApplied ? 'Remove chapters from all episodes' : 'Enable chapters for all episodes (copies delay below into each episode)'"
                                            @click="toggleApplyChapters"
                                        >
                                            {{ allChaptersApplied ? `Remove Chapters (${chaptersAppliedCount})` : chaptersAppliedCount > 0 ? `Copy Chapters (${chaptersAppliedCount}/${filteredFiles.length})` : 'Copy Chapters' }}
                                        </button>
                                        <div class="flex items-center gap-1">
                                            <span class="text-sm text-muted-foreground">and delay by</span>
                                            <NumberFieldRoot v-model="chapterDelay" :step="100" class="w-24">
                                                <div class="flex rounded-md border border-input bg-background overflow-hidden focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                                                    <NumberFieldInput
                                                        class="flex-1 min-w-0 bg-transparent outline-none px-2 py-1 text-sm tabular-nums text-right placeholder:text-muted-foreground"
                                                    />
                                                </div>
                                            </NumberFieldRoot>
                                            <span class="text-sm text-muted-foreground">ms</span>
                                        </div>
                                    </div>
                                </section>

                                <!-- Stream Configuration with Tabs -->
                                <section v-if="directory" class="rounded-lg border bg-card p-6 space-y-4">
                                    <TabsRoot v-model="activeStreamTab" class="w-full">
                                        <div class="flex items-center justify-between">
                                            <h2 class="text-lg font-semibold">Stream Configuration</h2>
                                            <TabsList class="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
                                                <TabsTrigger value="video"
                                                    class="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                                                >Video</TabsTrigger>
                                                <TabsTrigger value="audio"
                                                    class="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                                                >Audio</TabsTrigger>
                                                <TabsTrigger value="subtitle"
                                                    class="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                                                >Subtitle</TabsTrigger>
                                                <TabsTrigger value="attachment"
                                                    class="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                                                >Attachment</TabsTrigger>
                                            </TabsList>
                                        </div>
                                        <div class="mt-4">
                                            <TabsContent value="video" class="mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                                                <StreamMatchBuilder ref="videoBuilderRef" v-model="videoItems" stream-type="video" />
                                            </TabsContent>
                                            <TabsContent value="audio" class="mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                                                <StreamMatchBuilder ref="audioBuilderRef" v-model="audioItems" stream-type="audio" />
                                            </TabsContent>
                                            <TabsContent value="subtitle" class="mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                                                <StreamMatchBuilder ref="subtitleBuilderRef" v-model="subtitleItems" stream-type="subtitle" />
                                            </TabsContent>
                                            <TabsContent value="attachment" class="mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                                                <StreamMatchBuilder ref="attachmentBuilderRef" v-model="attachmentItems" stream-type="attachment" />
                                            </TabsContent>
                                        </div>
                                    </TabsRoot>
                                </section>

                            </div>
                        </ScrollAreaViewport>
                        <ScrollAreaScrollbar orientation="vertical" class="group w-2.5 bg-muted/20">
                            <ScrollAreaThumb class="bg-muted-foreground/50 group-hover:bg-muted-foreground/80 rounded-full transition-colors" />
                        </ScrollAreaScrollbar>
                        <ScrollAreaCorner />
                    </ScrollAreaRoot>

                    <!-- Right Column: Stream Match Preview -->
                    <ScrollAreaRoot v-if="directory" class="xl:overflow-hidden xl:flex xl:flex-col" type="auto" :style="{ height: '100%' }">
                        <ScrollAreaViewport class="xl:flex-1 xl:min-h-0">
                            <section class="rounded-lg border bg-card p-6 space-y-4">
                                <h2 class="text-lg font-semibold">
                                    Stream Match Preview
                                    <span v-if="excludedFileCount > 0" class="text-xs font-normal text-muted-foreground ml-2">
                                        ({{ excludedFileCount }} file{{ excludedFileCount !== 1 ? 's' : '' }} excluded)
                                    </span>
                                </h2>

                                <div v-if="filteredFiles.length === 0" class="text-sm text-muted-foreground py-4 text-center">
                                    {{ files.length === 0 ? 'No files found in directory.' : 'No files match the current pattern.' }}
                                </div>
                                <StreamMatchPreview
                                    v-else
                                    :files="filePreviewStates"
                                    :source-directory="directory"
                                    :per-file-metadata="perFileMetadata"
                                    :per-file-chapters="perFileChapters"
                                    :per-file-chapter-delay="perFileChapterDelay"
                                    :per-file-excluded="perFileExcluded"
                                    :excluded-tracks-by-file="excludedTracksByFile"
                                    :per-file-episode-info="perFileEpisodeInfo"
                                    :per-file-season-override="perFileSeasonOverride"
                                    :per-file-episode-override="perFileEpisodeOverride"
                                    :per-track-modifiers-by-file="perTrackModifiersByFile"
                                    @update:per-file-metadata="handlePerFileMetadataUpdate"
                                    @update:per-file-chapters="handlePerFileChaptersUpdate"
                                    @update:per-file-chapter-delay="handlePerFileChapterDelayUpdate"
                                    @toggle-track-exclude="handleToggleTrackExclude"
                                    @toggle-source-exclude="handleToggleSourceExclude"
                                    @update:per-file-season-override="handlePerFileSeasonOverride"
                                    @update:per-file-episode-override="handlePerFileEpisodeOverride"
                                    @update:per-track-modifier="updatePerTrackModifier"
                                    @clear-per-track-modifier="clearPerTrackModifier"
                                />
                                <div v-if="pendingLoadCount > 0" class="text-xs text-muted-foreground text-center">
                                    Loading stream info for {{ pendingLoadCount }} file{{ pendingLoadCount !== 1 ? 's' : '' }}…
                                </div>
                            </section>
                        </ScrollAreaViewport>
                        <ScrollAreaScrollbar orientation="vertical" class="group w-2.5 bg-muted/20">
                            <ScrollAreaThumb class="bg-muted-foreground/50 group-hover:bg-muted-foreground/80 rounded-full transition-colors" />
                        </ScrollAreaScrollbar>
                        <ScrollAreaCorner />
                    </ScrollAreaRoot>

                </div>

                <!-- Actions -->
                <div class="flex justify-end gap-2 mt-6">
                    <button class="px-4 py-2 border rounded-md hover:bg-accent" @click="handleCancel">
                        Cancel
                    </button>
                    <button
                        class="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                        :disabled="!directory" @click="handleSave">
                        {{ isNew ? 'Add Source' : 'Save Changes' }}
                    </button>
                </div>
            </div>
        </main>
    </div>
</template>
