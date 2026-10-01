<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { runConcurrent } from '@/lib/concurrency';
import { makeDroppable, type IDragEvent } from '@vue-dnd-kit/core';
import { DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from 'reka-ui';
import {
    type MuxerSource,
    type ProjectData,
    type Episode,
    type StreamInfo,
    type TrackComparison,
    buildMuxerModel,
    demuxStreams,
    clearProbeCache,
    join,
    getCpuCount,
} from '@app/preload';
import sanitize from 'sanitize-filename';
import { type TmdbSeriesCache } from '@app/tmdb';
import { filenameParse } from '@ctrl/video-filename-parser';
import { tryParseRegex, isGenericSeasonName } from '@/lib/utils';
import type { EpisodeStatus } from '@/types/episode';
import EpisodeQueueItem from './EpisodeQueueItem.vue';
import { useEpisodeQueueStore, computeQueueCompletionStats } from '@/stores/useEpisodeQueueStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { templateFileNameFromStreamInfo } from '@/lib/stream-match';

interface TrackConfigItem {
    type: 'video' | 'audio' | 'subtitle' | 'attachment';
    index: number;
    enabled: boolean;
    title?: string;
    language?: string;
    codec?: string;
    dispositionFlags: string[];
    fileStreamIndex: number;
    matched: boolean;
    filename?: string;
    mimetype?: string;
    /** The source file path (demuxerMapKey) this track originated from — used for override keying. */
    demuxerMapKey: string;

    // ── Original source values (for reset-to-original) ──
    originalTitle?: string;
    originalLanguage?: string;
    originalDispositions: string[];
    originalDelay: number;
    currentDelay: number;
    originalTags: Record<string, string>;
    /** Tags after source modifications (perTrackModifiers, selector modify) applied. */
    muxedTags: Record<string, string>;
    /** Title after source modifications but before queue overrides. */
    muxedTitle?: string;
    /** Language after source modifications but before queue overrides. */
    muxedLanguage?: string;
    /** Dispositions after source modifications but before queue overrides. */
    muxedDispositions: string[];
    /** Delay per source perTrackModifiers (the source-modified value). */
    muxedDelay: number;
}

interface ChapterEntry {
    timestamp: string;
    /** Original timestamp before the group delay is applied. */
    originalTimestamp?: string;
    title: string;
    language?: string;
}

interface SourceChapterGroup {
    sourceIdx: number;
    label: string;
    chapters: ChapterEntry[];
    enabled: boolean;
    delay: number;
}

interface EpisodeQueueItemData {
    id: string;
    seasonNumber: number;
    episodeNumber: number;
    title: string;
    sourceFile: string;
    sourceDirectory: string;
    sourceIndex: number;
    additionalSources?: { sourceFile: string; sourceDirectory: string; sourceIndex: number }[];
    enabled: boolean;
    status: EpisodeStatus;
    streamCounts: { video: number; audio: number; subtitle: number; attachment: number };
    tracks: TrackConfigItem[];
    outputFilenamePreview?: string;
    matchedVideo: number;
    matchedAudio: number;
    matchedSubtitle: number;
    matchedAttachment: number;
    sourceChapterGroups: SourceChapterGroup[];
    filenameOverride?: string;
}

interface Props {
    sources: MuxerSource[];
    filesBySource: Record<string, string[]>;
    tmdbSeries: TmdbSeriesCache | null;
    /** When true, suppress episode rebuild on project changes — used while the rename template modal is open. */
    renameModalOpen?: boolean;
}

const props = defineProps<Props>();
const queueStore = useEpisodeQueueStore();
const projectStore = useProjectStore();
const settingsStore = useSettingsStore();

// ─── Episode data ─────────────────────────────────────────────

const episodes = ref<EpisodeQueueItemData[]>([]);
const selectedIds = ref<Set<string>>(new Set());
const expandedEpisodeId = ref<string | null>(null);

/**
 * Flag to suppress rebuildEpisodes when the only source change was a
 * chapter toggle already applied locally. Set before travels.setState(),
 * consumed and cleared in the props watch guard.
 * A boolean is idempotent — successive toggles before the next watch
 * flush all set the same true, with no leak.
 * Both watchers check read-only (no consumption); handleToggleChapters
 * resets via nextTick after both watchers have had their chance to fire.
 */
let suppressChapterRebuild = false;

// ─── Helpers (unchanged from original) ────────────────────────

function computeSeasonFolderName(seasonNumber: number, seasonName?: string): string {
    if (seasonName !== undefined && seasonName !== '') {
        if (seasonNumber === 0) return sanitize(seasonName);
        return `Season ${seasonNumber} - ${sanitize(seasonName)}`;
    }
    return `Season ${seasonNumber}`;
}

function resolveSeasonName(
    seasonNames: Record<number, string> | undefined,
    seasonNum: number,
    tmdbName: string | undefined,
): string | undefined {
    if (seasonNames && seasonNum in seasonNames) {
        return seasonNames[seasonNum];
    }
    return tmdbName && !isGenericSeasonName(tmdbName) ? tmdbName : undefined;
}

function buildTrackItemsFromComparisons(comparisons: TrackComparison[]): TrackConfigItem[] {
    const tracks: TrackConfigItem[] = [];
    for (const comp of comparisons) {
        const type = comp.codecType as 'video' | 'audio' | 'subtitle' | 'attachment';
        const codec = comp.muxedCodec !== 'unknown' ? comp.muxedCodec : comp.originalCodec;
        tracks.push({
            type,
            index: tracks.length,
            enabled: true,
            title: comp.muxedTitle,
            language: comp.muxedLanguage,
            codec,
            dispositionFlags: [...(comp.muxedDispositions ?? [])],
            fileStreamIndex: comp.originalIndex,
            matched: true,
            filename: comp.muxedFilename,
            mimetype: comp.muxedMimetype,
            demuxerMapKey: comp.demuxerMapKey,

            // Original source values (filled in by buildModelForItem after this call)
            originalTitle: comp.originalTitle,
            originalLanguage: comp.originalLanguage,
            originalDispositions: [...(comp.originalDispositions ?? [])],
            originalDelay: 0,
            currentDelay: comp.muxedDelay ?? 0,
            originalTags: {},
            muxedTags: comp.muxedMetadata ? { ...comp.muxedMetadata } : {},
            muxedTitle: comp.muxedTitle,
            muxedLanguage: comp.muxedLanguage,
            muxedDispositions: [...(comp.muxedDispositions ?? [])],
            muxedDelay: comp.muxedDelay ?? 0,
        });
    }
    return tracks;
}

function parseChapterTimestamp(rawKey: string): string {
    const parts = rawKey.replace(/^_/, '').split('_');
    if (parts.length !== 4) return rawKey.replace(/_/g, ':');
    const [h, m, s, ms] = parts;
    return `${h}:${m}:${s}.${ms}`;
}

function parseChapterTitle(rawValue: string): { title: string; language?: string } {
    const colonIdx = rawValue.indexOf(':');
    if (colonIdx > 0 && colonIdx <= 4) {
        const prefix = rawValue.slice(0, colonIdx);
        if (/^[a-z]{2,3}$/.test(prefix)) {
            return { title: rawValue.slice(colonIdx + 1).trim() || rawValue, language: prefix };
        }
    }
    return { title: rawValue };
}

function parseChapterTimestampToMs(timestamp: string): number | null {
    const match = timestamp.match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const millis = Number(match[4]!.padEnd(3, '0'));
    if ([hours, minutes, seconds, millis].some((n) => Number.isNaN(n))) return null;
    return ((hours * 3600 + minutes * 60 + seconds) * 1000) + millis;
}

function formatChapterTimestamp(ms: number): string {
    const clipped = Math.max(0, Math.round(ms));
    const hours = Math.floor(clipped / 3600000);
    const minutes = Math.floor((clipped % 3600000) / 60000);
    const seconds = Math.floor((clipped % 60000) / 1000);
    const millis = clipped % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function shiftChapterTimestamp(timestamp: string, delayMs: number): string {
    if (!delayMs) return timestamp;
    const base = parseChapterTimestampToMs(timestamp);
    if (base === null) return timestamp;
    return formatChapterTimestamp(base + delayMs);
}

function extractChaptersFromStreamInfo(filePath: string, delayMs = 0): ChapterEntry[] {
    const streamInfos = demuxPreviewCache.value[filePath];
    if (!streamInfos || streamInfos.length === 0) return [];
    const containerMeta = streamInfos[0]?.containerMeta;
    if (!containerMeta) return [];
    const rawChapters = containerMeta['_Chapters'] as Record<string, string> | undefined;
    if (!rawChapters) return [];
    const result: ChapterEntry[] = [];
    for (const [key, val] of Object.entries(rawChapters)) {
        if (val && typeof val === 'string') {
            const { title, language } = parseChapterTitle(val);
            const originalTimestamp = parseChapterTimestamp(key);
            const timestamp = shiftChapterTimestamp(originalTimestamp, delayMs);
            result.push({
                timestamp,
                ...(delayMs !== 0 && { originalTimestamp }),
                title,
                language,
            });
        }
    }
    return result;
}

const demuxPreviewCache = ref<Record<string, StreamInfo[] | null>>({});

/**
 * Build an Episode object from queue item data, source config, and project settings.
 */
function buildEpisodeFromItem(
    item: EpisodeQueueItemData,
    source: MuxerSource,
    project: ProjectData,
    seasonData: { name?: string } | undefined,
    episodeName: string | undefined,
): Episode {
    const seriesFolder = sanitize(project.seriesName || 'Unknown Series');
    const seasonName = resolveSeasonName(project.seasonNames, item.seasonNumber, seasonData?.name);
    const seasonFolder = computeSeasonFolderName(item.seasonNumber, seasonName);
    const baseDir = project.outputDirectory || item.sourceDirectory;
    const outputDir = baseDir ? join(baseDir, seriesFolder, seasonFolder) : '';

    const resolvedTemplate = project.rename.filenameOverrides?.[item.id] ?? project.rename.template;

    const buildSourceEntry = (src: MuxerSource, srcFile: string): Episode['sources'][0] => {
        const chaptersEnabled = src.perFileChapters?.[srcFile] ?? false;
        const chaptersDelay = src.perFileChapterDelay?.[srcFile];
        const metadataEnabled = src.perFileMetadata?.[srcFile] ?? false;
        return {
            file: { directory: src.directory, name: srcFile },
            ...(chaptersEnabled
                ? { chapters: { ...(chaptersDelay !== undefined && { delay: chaptersDelay }) } }
                : undefined),
            ...(metadataEnabled && { inheritMetadata: true }),
            ...(src.excludedTracks?.[srcFile] && { excludedTracks: src.excludedTracks[srcFile] }),
            ...(src.perTrackModifiers?.[srcFile] && { perTrackModifiers: src.perTrackModifiers[srcFile] }),
            video: src.video,
            audio: src.audio,
            subtitle: src.subtitle,
            attachment: src.attachment,
        };
    };

    const sources: Episode['sources'] = [buildSourceEntry(source, item.sourceFile)];
    if (item.additionalSources) {
        for (const addSrc of item.additionalSources) {
            const addSource = props.sources[addSrc.sourceIndex];
            if (addSource) sources.push(buildSourceEntry(addSource, addSrc.sourceFile));
        }
    }

    return {
        file: {
            directory: outputDir,
            name: item.sourceFile,
            overwrite: ((project.muxOptions as Record<string, unknown>)?.perFileOverwrite as Record<string, boolean> | undefined)?.[item.id] ?? project.muxOptions.overwrite,
            rename: { template: resolvedTemplate, fieldConfig: project.rename.fieldConfig },
        },
        series: {
            name: project.seriesName,
            season: { number: item.seasonNumber, name: seasonData?.name },
            episode: { number: item.episodeNumber, name: episodeName },
        },
        ...(project.muxOptions.modifyTags && { modifyTags: project.muxOptions.modifyTags as Record<string, string> }),
        method: settingsStore.multiplexerMethod,
        sources,
    };
}

/** Apply stored track overrides to the model (pure data, no live mutation). */
function applyOverridesToModel(
    tracks: TrackConfigItem[],
    overrides: Record<string, { title?: string; language?: string; disposition?: Record<string, boolean>; tags?: Record<string, string> }> | undefined,
): void {
    if (!overrides) return;
    // Map of disposition numeric key → display label
    const DISP_KEY_TO_LABEL: Record<string, string> = {
        '1': 'Default', '2': 'Dub', '4': 'Original', '8': 'Comment',
        '16': 'Lyrics', '32': 'Karaoke', '64': 'Forced', '128': 'Hearing Impaired',
        '256': 'Visual Impaired', '512': 'Clean Effects', '1024': 'Attached Picture',
        '2048': 'Timed Thumbnails', '4096': 'Non-Diegetic', '65536': 'Captions',
        '131072': 'Descriptions', '262144': 'Metadata', '524288': 'Dependent',
        '1048576': 'Still Image', '2097152': 'Multilayer',
    };
    for (const [stableKey, mod] of Object.entries(overrides)) {
        const lastColon = stableKey.lastIndexOf(':');
        if (lastColon <= 0) continue;
        const mapKey = stableKey.slice(0, lastColon);
        const originalIdx = Number(stableKey.slice(lastColon + 1));
        const matchingTrack = tracks.find(t => t.demuxerMapKey === mapKey && t.fileStreamIndex === originalIdx);
        if (!matchingTrack) continue;

        if (mod.title !== undefined) {
            matchingTrack.title = mod.title || undefined;
        }
        if (mod.language !== undefined) {
            matchingTrack.language = mod.language || undefined;
        }
        if (mod.disposition) {
            matchingTrack.dispositionFlags = Object.entries(mod.disposition)
                .filter(([, v]) => v)
                .map(([k]) => DISP_KEY_TO_LABEL[k] ?? '')
                .filter(Boolean);
        }
        if (mod.tags) {
            for (const [key, value] of Object.entries(mod.tags)) {
                if (value === '') delete matchingTrack.muxedTags[key];
                else matchingTrack.muxedTags[key] = value;
            }
        }
    }
}

let rebuildInProgress = false;
let needsRebuild = false;

async function rebuildEpisodes() {
    if (rebuildInProgress) { needsRebuild = true; return; }
    rebuildInProgress = true;
    try {
        const rows: EpisodeQueueItemData[] = [];
        const project = projectStore.currentProject;

        for (let sourceIdx = 0; sourceIdx < props.sources.length; sourceIdx++) {
            const source = props.sources[sourceIdx];
            if (!source.directory) continue;
            const files = props.filesBySource[source.directory] || [];

            for (const file of files) {
                // Extract episode/season numbers — try regex capture groups first,
                // then fall back to @ctrl/video-filename-parser.
                // This mirrors the backend generateSeasonMap() behavior.
                let seasonNumber: number | undefined;
                let rawEpisode: number | undefined;

                if (source.match?.regex) {
                    const flags = source.match.regexFlags ?? '';
                    const regex = tryParseRegex(source.match.regex, flags);
                    if (regex) {
                        const matchResult = file.match(regex);
                        if (matchResult) {
                            const episodeStr = matchResult[source.match.episodeIndex];
                            if (episodeStr !== undefined) {
                                const parsed = parseInt(episodeStr, 10);
                                if (!isNaN(parsed)) rawEpisode = parsed;
                            }
                            if (source.match.seasonIndex !== undefined) {
                                const seasonStr = matchResult[source.match.seasonIndex];
                                if (seasonStr !== undefined) {
                                    const parsed = parseInt(seasonStr, 10);
                                    if (!isNaN(parsed)) seasonNumber = parsed;
                                }
                            }
                        } else {
                            // File doesn't match the regex filter — skip entirely
                            continue;
                        }
                    }
                }

                // Fall back to filenameParse if regex didn't extract episode number
                const parsed = filenameParse(file, true) as { seasons?: number[]; episodeNumbers?: number[]; title?: string };
                if (rawEpisode === undefined) {
                    rawEpisode = parsed.episodeNumbers?.[0];
                    if (seasonNumber === undefined) {
                        seasonNumber = parsed.seasons?.[0];
                    }
                }
                seasonNumber = source.season ?? seasonNumber ?? 1;
                const episodeNumber = rawEpisode != null ? rawEpisode + (source.episodeOffset ?? 0) : 0;
                const finalSeason = source.perFileSeasonOverride?.[file] ?? seasonNumber;
                const finalEpisode = source.perFileEpisodeOverride?.[file] ?? episodeNumber;
                const status: EpisodeStatus = finalEpisode > 0 ? 'pending' : 'unassigned';
                const id = `${source.directory}::${file}`;
                if (source.perFileExcluded?.[file]) continue;

                const item: EpisodeQueueItemData = {
                    id, seasonNumber: finalSeason, episodeNumber: finalEpisode, title: '',
                    sourceFile: file, sourceDirectory: source.directory, sourceIndex: sourceIdx,
                    enabled: true, status,
                    streamCounts: { video: 0, audio: 0, subtitle: 0, attachment: 0 },
                    tracks: [], outputFilenamePreview: undefined,
                    matchedVideo: 0, matchedAudio: 0, matchedSubtitle: 0, matchedAttachment: 0,
                    sourceChapterGroups: [], filenameOverride: project?.rename.filenameOverrides?.[id],
                };

                const seasonData = props.tmdbSeries?.seasons[finalSeason];
                const tmdbEpisode = seasonData?.episodes[finalEpisode];
                const overrideKey = `${finalSeason}-${finalEpisode}`;
                const overrideName = projectStore.currentProject?.episodeNameOverrides?.[overrideKey];
                item.title = overrideName ?? tmdbEpisode?.name ?? parsed.title ?? projectStore.currentProject?.seriesName ?? '';
                rows.push(item);
            }

            if (files.length === 0) {
                rows.push({
                    id: `${source.directory}::(empty)`, seasonNumber: 1, episodeNumber: 0, title: '',
                    sourceFile: '(no files loaded)', sourceDirectory: source.directory, sourceIndex: sourceIdx,
                    enabled: true, status: 'pending',
                    streamCounts: { video: 0, audio: 0, subtitle: 0, attachment: 0 },
                    tracks: [], outputFilenamePreview: undefined,
                    matchedVideo: 0, matchedAudio: 0, matchedSubtitle: 0, matchedAttachment: 0,
                    sourceChapterGroups: [],
                });
            }
        }

        // Merge duplicate episodes
        const mergedRows: EpisodeQueueItemData[] = [];
        const episodeGroups = new Map<string, EpisodeQueueItemData[]>();
        for (const row of rows) {
            if (row.episodeNumber > 0) {
                const key = `${row.seasonNumber}-${row.episodeNumber}`;
                const group = episodeGroups.get(key) ?? [];
                group.push(row);
                episodeGroups.set(key, group);
            } else mergedRows.push(row);
        }
        for (const [, group] of episodeGroups) {
            if (group.length === 1) mergedRows.push(group[0]);
            else {
                const [primary, ...rest] = group;
                primary.additionalSources = rest.map(r => ({ sourceFile: r.sourceFile, sourceDirectory: r.sourceDirectory, sourceIndex: r.sourceIndex }));
                primary.id = `merged:${primary.seasonNumber}-${primary.episodeNumber}`;
                primary.enabled = group.some(g => g.enabled);
                mergedRows.push(primary);
            }
        }

        episodes.value = mergedRows;

        if (project) {
            const cpuCount = getCpuCount();
            const concurrency = Math.max(1, cpuCount - 2);
            // Mark every real episode as loading before probing sources. The
            // placeholder "(no files loaded)" rows have no source to probe and
            // keep their static status.
            for (const item of mergedRows) {
                if (item.sourceFile !== '(no files loaded)') {
                    item.status = 'loading';
                }
            }
            await runConcurrent(mergedRows, (item) => buildModelForItem(item, project), Math.min(concurrency, 6));
        }
    } finally {
        rebuildInProgress = false;
        if (needsRebuild) { needsRebuild = false; rebuildEpisodes(); }
    }
}

async function buildModelForItem(item: EpisodeQueueItemData, project: ProjectData): Promise<void> {
    const source = props.sources[item.sourceIndex];
    if (!source) return;
    const seasonData = props.tmdbSeries?.seasons[item.seasonNumber];
    const tmdbEpisode = seasonData?.episodes[item.episodeNumber];
    const overrideKey = `${item.seasonNumber}-${item.episodeNumber}`;
    const overrideName = project.episodeNameOverrides?.[overrideKey];
    const episodeName = overrideName || item.title || tmdbEpisode?.name || undefined;

    try {
        const episode = buildEpisodeFromItem(item, source, project, seasonData, episodeName);
        const serialized = JSON.parse(JSON.stringify(episode, (_key, val) => val instanceof RegExp ? val.toString() : val)) as Episode;
        const { comparisons, streamInfos } = await buildMuxerModel(serialized);
        const filePath = `${source.directory}/${item.sourceFile}`;
        demuxPreviewCache.value[filePath] = streamInfos;

        // Also probe additional source files so chapter lookups by their
        // file path find cached data. The backend probe cache makes
        // subsequent calls free.
        if (item.additionalSources) {
            await Promise.all(item.additionalSources.map(async (addSrc) => {
                const addPath = `${addSrc.sourceDirectory}/${addSrc.sourceFile}`;
                if (!demuxPreviewCache.value[addPath]) {
                    try {
                        demuxPreviewCache.value[addPath] = await demuxStreams(addPath);
                    } catch {
                        // non-critical
                    }
                }
            }));
        }

        const ep = episodes.value.find(e => e.id === item.id);
        if (ep) {
            const realTracks = buildTrackItemsFromComparisons(comparisons);

            // Populate original tags and delay from source data
            for (const track of realTracks) {
                // Find matching StreamInfo for this track's fileStreamIndex
                const matchedInfo = streamInfos.find(si => si.index === track.fileStreamIndex);
                track.originalTags = matchedInfo?.metadata ?? {};
                // Delay from the muxer model comparison (rule modify + per-track
                // merged). Fall back to per-track modifiers for robustness.
                const sourceDelay = source.perTrackModifiers?.[item.sourceFile]?.[track.fileStreamIndex]?.delay ?? 0;
                track.originalDelay = track.muxedDelay !== 0 ? track.muxedDelay : sourceDelay;
                track.muxedDelay = track.originalDelay;

                // Compute effective delay from override or muxed
                const overrideDelay = project.queueTrackOverrides?.[item.id]?.[`${track.demuxerMapKey}:${track.fileStreamIndex}`]?.delay;
                track.currentDelay = overrideDelay ?? track.muxedDelay;
            }

            // Apply stored queue track overrides (pure data, no live mutation)
            applyOverridesToModel(realTracks, project.queueTrackOverrides?.[item.id]);

            ep.tracks = realTracks;
            ep.matchedVideo = realTracks.filter(t => t.type === 'video').length;
            ep.matchedAudio = realTracks.filter(t => t.type === 'audio').length;
            ep.matchedSubtitle = realTracks.filter(t => t.type === 'subtitle').length;
            ep.matchedAttachment = realTracks.filter(t => t.type === 'attachment').length;
            ep.streamCounts = {
                video: realTracks.filter(t => t.type === 'video').length,
                audio: realTracks.filter(t => t.type === 'audio').length,
                subtitle: realTracks.filter(t => t.type === 'subtitle').length,
                attachment: realTracks.filter(t => t.type === 'attachment').length,
            };

            if (item.episodeNumber > 0) {
                try {
                    const seasonName = resolveSeasonName(project.seasonNames, item.seasonNumber, seasonData?.name);
                    const effectiveTemplate = project.rename.filenameOverrides?.[item.id] ?? project.rename.template;
                    const preview = templateFileNameFromStreamInfo(
                        effectiveTemplate,
                        { name: project.seriesName, season: { number: item.seasonNumber, name: seasonName }, episode: { number: item.episodeNumber, name: episodeName } },
                        streamInfos, comparisons, project.rename.fieldConfig,
                    );
                    if (preview) {
                        const seriesFolder = sanitize(project.seriesName);
                        const seasonFolder = computeSeasonFolderName(item.seasonNumber, seasonName);
                        ep.outputFilenamePreview = join(seriesFolder, seasonFolder, `${sanitize(preview)}.mkv`);
                    }
                } catch { /* non-critical */ }
            }
            // Resolve per-source chapter groups for display.
            // A group exists when the file has an explicit per-file entry
            // (even if toggled off).
            const groups: Array<{ sourceIdx: number; label: string; chapters: ChapterEntry[]; enabled: boolean; delay: number }> = [];

            // Primary source
            {
                const hasConfig = source.perFileChapters?.[item.sourceFile] !== undefined;
                if (hasConfig) {
                    const delay = source.perFileChapterDelay?.[item.sourceFile] ?? 0;
                    const primaryChapters = extractChaptersFromStreamInfo(filePath, delay);
                    if (primaryChapters.length > 0) {
                        groups.push({
                            sourceIdx: item.sourceIndex,
                            label: item.sourceFile,
                            chapters: primaryChapters,
                            enabled: source.perFileChapters?.[item.sourceFile] ?? false,
                            delay,
                        });
                    }
                }
            }

            // Additional sources
            if (item.additionalSources?.length) {
                for (const addSrc of item.additionalSources) {
                    const src = props.sources[addSrc.sourceIndex];
                    if (!src) continue;
                    const hasConfig = src.perFileChapters?.[addSrc.sourceFile] !== undefined;
                    if (!hasConfig) continue;
                    const addPath = `${src.directory}/${addSrc.sourceFile}`;
                    const delay = src.perFileChapterDelay?.[addSrc.sourceFile] ?? 0;
                    const addChapters = extractChaptersFromStreamInfo(addPath, delay);
                    if (addChapters.length > 0) {
                        groups.push({
                            sourceIdx: addSrc.sourceIndex,
                            label: addSrc.sourceFile,
                            chapters: addChapters,
                            enabled: src.perFileChapters?.[addSrc.sourceFile] ?? false,
                            delay,
                        });
                    }
                }
            }

            ep.sourceChapterGroups = groups;
            // Loading finished — restore the static status so the item is
            // muxable again (unassigned episodes stay unassigned).
            ep.status = item.episodeNumber > 0 ? 'pending' : 'unassigned';
        }
    } catch {
        // Item couldn't be modeled — mark it as errored so it's visibly
        // broken and cannot be muxed.
        const ep = episodes.value.find(e => e.id === item.id);
        if (ep) {
            ep.status = 'error';
        }
    }
}

// ─── Cleanup on unmount ────────────────────────────────────────
// Clear probe cache when the component is destroyed.
onBeforeUnmount(() => {
    clearProbeCache();
    demuxPreviewCache.value = {};
    episodes.value = [];
});

watch(() => [props.sources, props.filesBySource, props.tmdbSeries], () => {
    if (suppressChapterRebuild) return;
    rebuildEpisodes();
}, { immediate: true });

// ─── Debounced project change handler ─────────────────────────

let rebuildTimer: ReturnType<typeof setTimeout> | undefined;

type ChangeType = 'metadata-only' | 'full-rebuild';

function classifyChange(newP: ProjectData, oldP: ProjectData | undefined): ChangeType {
    if (!oldP) return 'full-rebuild';
    if (JSON.stringify(newP.sources) !== JSON.stringify(oldP.sources)) return 'full-rebuild';
    const oldMux = oldP.muxOptions ?? {};
    const newMux = newP.muxOptions ?? {};
    const { modifyTags: _oldTags, ...oldRest } = oldMux;
    const { modifyTags: _newTags, ...newRest } = newMux;
    if (JSON.stringify(oldRest) !== JSON.stringify(newRest)) return 'full-rebuild';
    if (newP.tmdbSeriesId !== oldP.tmdbSeriesId) return 'full-rebuild';
    return 'metadata-only';
}

function refreshEpisodeMetadata() {
    const project = projectStore.currentProject;
    if (!project) return;
    for (const ep of episodes.value) {
        // Sync filenameOverride from project store (may have been cleared)
        ep.filenameOverride = project.rename.filenameOverrides?.[ep.id];
        const source = props.sources[ep.sourceIndex];
        if (!source) continue;
        const seasonData = props.tmdbSeries?.seasons[ep.seasonNumber];
        const tmdbEpisode = seasonData?.episodes[ep.episodeNumber];
        const overrideKey = `${ep.seasonNumber}-${ep.episodeNumber}`;
        const overrideName = project.episodeNameOverrides?.[overrideKey];
        const seasonName = resolveSeasonName(project.seasonNames, ep.seasonNumber, seasonData?.name);

        if (ep.episodeNumber > 0 && ep.tracks.length > 0) {
            try {
                const filePath = `${source.directory}/${ep.sourceFile}`;
                const streamInfos = demuxPreviewCache.value[filePath] ?? [];
                const comparisons = ep.tracks.map(t => ({
                    outputIndex: t.index, codecType: t.type, demuxerMapKey: filePath,
                    originalIndex: t.fileStreamIndex, originalCodec: t.codec ?? 'unknown',
                    originalTitle: undefined, originalLanguage: undefined, originalDispositions: [],
                    muxedCodec: t.codec ?? 'unknown', muxedTitle: t.title, muxedLanguage: t.language,
                    muxedDispositions: t.dispositionFlags, muxedFilename: t.filename, muxedMimetype: t.mimetype,
                })) as TrackComparison[];
                const effectiveTemplate = project.rename.filenameOverrides?.[ep.id] ?? project.rename.template;
                const preview = templateFileNameFromStreamInfo(
                    effectiveTemplate,
                    { name: project.seriesName, season: { number: ep.seasonNumber, name: seasonName }, episode: { number: ep.episodeNumber, name: overrideName || ep.title || tmdbEpisode?.name || '' } },
                    streamInfos, comparisons, project.rename.fieldConfig,
                );
                if (preview) {
                    const seriesFolder = sanitize(project.seriesName);
                    const seasonFolder = computeSeasonFolderName(ep.seasonNumber, seasonName);
                    ep.outputFilenamePreview = join(seriesFolder, seasonFolder, `${sanitize(preview)}.mkv`);
                }
            } catch { /* non-critical */ }
        }
    }
}

watch(
    () => [projectStore.currentProject, props.renameModalOpen] as const,
    ([newProject, modalOpen], [oldProject]) => {
        if (!newProject || episodes.value.length === 0) return;
        if (modalOpen) return;
        refreshEpisodeMetadata();
        if (suppressChapterRebuild) return;
        const changeType = classifyChange(newProject, oldProject ?? undefined);
        if (changeType === 'full-rebuild') {
            // A rebuild means source or mux-option config changed underneath
            // every row, so no existing output can be trusted any more.
            for (const ep of episodes.value) queueStore.invalidateEpisode(ep.id);
            if (rebuildTimer) clearTimeout(rebuildTimer);
            rebuildTimer = setTimeout(() => { rebuildEpisodes(); rebuildTimer = undefined; }, 500);
        }
    },
);

// ─── DnD ─────────────────────────────────────────────────────

const episodeListRef = ref<HTMLDivElement | null>(null);

function applySort(event: IDragEvent) {
    const result = event.helpers.suggestSort('vertical');
    if (!result) return;
    episodes.value = result.targetItems as EpisodeQueueItemData[];
}

makeDroppable(episodeListRef, { events: { onDrop: applySort } }, () => episodes.value);

// ─── Selection ───────────────────────────────────────────────

const selectedCount = computed(() => selectedIds.value.size);
const hasSelection = computed(() => selectedCount.value > 0);
const hasSources = computed(() => props.sources.length > 0);
const unassignedCount = computed(() => episodes.value.filter(e => e.status === 'unassigned').length);

/** True while any episode is still probing its sources — muxing must wait. */
const isAnyLoading = computed(() => episodes.value.some(e => e.status === 'loading'));

const processingStats = computed(() => ({
    ...computeQueueCompletionStats(episodes.value, (id) => queueStore.getProgress(id).status),
    isActive: queueStore.hasActiveProcessing,
}));

function selectAll() { selectedIds.value = new Set(episodes.value.map(e => e.id)); }
function selectNone() { selectedIds.value = new Set(); }
function invertSelection() {
    const next = new Set(episodes.value.map(e => e.id));
    for (const id of selectedIds.value) next.delete(id);
    selectedIds.value = next;
}

// ─── Bulk operations ─────────────────────────────────────────

function bulkEnable() { if (queueStore.hasActiveProcessing) return; for (const id of selectedIds.value) { const e = episodes.value.find(ep => ep.id === id); if (e) e.enabled = true; } }
function bulkDisable() { if (queueStore.hasActiveProcessing) return; for (const id of selectedIds.value) { const e = episodes.value.find(ep => ep.id === id); if (e) e.enabled = false; } }
function bulkStart() {
    const ids = episodes.value.filter(e => selectedIds.value.has(e.id) && e.enabled && e.status !== 'loading').map(e => e.id);
    if (ids.length > 0) queueStore.startBatchProcessing(ids, episodesDataMap.value);
}
function bulkStop() { for (const id of selectedIds.value) queueStore.stopProcessing(id); }
function bulkReset() {
    if (queueStore.hasActiveProcessing) return;
    for (const id of selectedIds.value) queueStore.resetEpisode(id);
}

// ─── Per-episode actions (called from item emits) ────────────

function handleToggleExpand(id: string) {
    expandedEpisodeId.value = expandedEpisodeId.value === id ? null : id;
}

function toggleEnabled(id: string) { const ep = episodes.value.find(e => e.id === id); if (ep) ep.enabled = !ep.enabled; }
function startProcessing(id: string) {
    const ep = episodes.value.find(e => e.id === id);
    if (ep?.status === 'loading') return; // Sources still probing — not muxable yet
    queueStore.startProcessing(id, episodesDataMap.value.get(id));
}
function restartProcessing(id: string) {
    const ep = episodes.value.find(e => e.id === id);
    if (ep?.status === 'loading') return; // Sources still probing — not muxable yet
    queueStore.restartEpisode(id, episodesDataMap.value.get(id));
}
function resetEpisode(id: string) { queueStore.resetEpisode(id); }
function stopProcessing(id: string) { queueStore.stopProcessing(id); }

// Per-episode edits below invalidate the episode's completion so it counts as
// pending work again. Source-level edits (stream match rules, excluded tracks,
// TMDB name overrides) are deliberately not handled here — they would need
// per-episode impact analysis to know which rows they actually affect.
function clearFilenameOverride(id: string): void {
    projectStore.updateProject((d: ProjectData) => { if (d.rename.filenameOverrides) delete d.rename.filenameOverrides[id]; });
    queueStore.invalidateEpisode(id);
}

function setFilenameOverride(id: string, value: string): void {
    projectStore.updateProject((d: ProjectData) => {
        if (!d.rename.filenameOverrides) d.rename.filenameOverrides = {};
        d.rename.filenameOverrides[id] = value;
    });
    queueStore.invalidateEpisode(id);
}

function handleToggleOverwrite(id: string) {
    projectStore.updateProject((d: ProjectData) => {
        if (!d.muxOptions) d.muxOptions = {};
        const opts = d.muxOptions as Record<string, unknown>;
        if (!opts.perFileOverwrite) opts.perFileOverwrite = {};
        const map = opts.perFileOverwrite as Record<string, boolean>;
        map[id] = !map[id];
    });
    // Overwrite changes what the next run does to an existing output file.
    queueStore.invalidateEpisode(id);
}

function handleToggleChapters(episodeId: string, sourceIdx: number) {
    const ep = episodes.value.find(e => e.id === episodeId);
    if (!ep) return;
    const group = ep.sourceChapterGroups.find(g => g.sourceIdx === sourceIdx);
    if (!group) return;
    const newEnabled = !group.enabled;
    // Toggle locally — instant UI, no flicker.
    group.enabled = newEnabled;
    // Record in travels for undo/redo.
    // Both watchers check the flag read-only; reset after the current
    // flush so both have had their chance to fire.
    suppressChapterRebuild = true;
    projectStore.updateProject((draft: ProjectData) => {
        if (!draft.sources[sourceIdx].perFileChapters)
            draft.sources[sourceIdx].perFileChapters = {};
        draft.sources[sourceIdx].perFileChapters![group.label] = newEnabled;
    });
    // The toggle is per-file, so only this episode's chapters changed.
    queueStore.invalidateEpisode(episodeId);
    nextTick(() => { suppressChapterRebuild = false; });
}

function toggleSelect(id: string) {
    const next = new Set(selectedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds.value = next;
}

function copyFilenamesFromSource(sourceIdx: number): void {
    projectStore.updateProject((d: ProjectData) => {
        for (const ep of episodes.value) {
            if (ep.sourceIndex === sourceIdx) {
                const dotIdx = ep.sourceFile.lastIndexOf('.');
                const basename = dotIdx > 0 ? ep.sourceFile.slice(0, dotIdx) : ep.sourceFile;
                if (!d.rename.filenameOverrides) d.rename.filenameOverrides = {};
                d.rename.filenameOverrides[ep.id] = basename;
            }
        }
    });
}

defineExpose({ copyFilenamesFromSource });

function startAllEnabled() {
    const enabledIds = episodes.value.filter(e => e.enabled && e.status !== 'loading').map(e => e.id);
    if (enabledIds.length > 0) queueStore.startBatchProcessing(enabledIds, episodesDataMap.value);
}

function stopAllProcessing() { queueStore.stopAllProcessing(); }

// ─── Header progress ─────────────────────────────────────────

const totalProgress = computed(() => {
    const { completed, total } = processingStats.value;
    if (total === 0) return 0;
    return Math.min(100, Math.round((completed / total) * 100));
});

const episodesDataMap = computed<Map<string, Episode>>(() => {
    const map = new Map<string, Episode>();
    const project = projectStore.currentProject;
    if (!project) return map;
    for (const item of episodes.value) {
        const source = props.sources[item.sourceIndex];
        if (!source) continue;
        const seasonData = props.tmdbSeries?.seasons[item.seasonNumber];
        const tmdbEpisode = seasonData?.episodes[item.episodeNumber];
        const overrideKey = `${item.seasonNumber}-${item.episodeNumber}`;
        const overrideName = project.episodeNameOverrides?.[overrideKey];
        const episodeName = overrideName || item.title || tmdbEpisode?.name || undefined;
        map.set(item.id, buildEpisodeFromItem(item, source, project, seasonData, episodeName));
    }
    return map;
});
</script>

<template>
    <div class="space-y-3">
        <!-- ── Header Card ──────────────────────────────────────── -->
            <div class="rounded-lg border bg-card text-card-foreground shadow-sm px-4 py-3">
                <div class="flex items-center gap-3">
                    <div class="flex-1 min-w-0">
                        <div class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full">
                            <div class="h-1.5 rounded-full transition-all duration-300"
                                :class="processingStats.errors > 0 ? 'bg-red-500' : processingStats.completed === processingStats.total && processingStats.total > 0 ? 'bg-green-500' : 'bg-blue-500'"
                                :style="{ width: `${totalProgress}%` }" />
                        </div>
                    </div>
                    <div class="text-xs text-muted-foreground tabular-nums shrink-0">
                        <span :class="processingStats.errors > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'">{{ processingStats.completed }}</span>
                        /{{ processingStats.total }} episodes
                    </div>
                    <button v-if="!processingStats.isActive"
                        class="shrink-0 px-3 py-1 text-xs font-medium bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
                        :disabled="episodes.length === 0 || isAnyLoading" @click="startAllEnabled">
                        ▶ Start All
                    </button>
                    <button v-else
                        class="shrink-0 px-3 py-1 text-xs font-medium bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                        @click="stopAllProcessing">
                        ■ Stop All
                    </button>
                    <DropdownMenuRoot>
                        <DropdownMenuTrigger as-child>
                            <button class="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="bottom" align="end" :side-offset="4"
                            class="z-50 min-w-44 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
                            <DropdownMenuSeparator class="my-1 h-px bg-border" />
                            <DropdownMenuItem class="text-xs px-2 py-1.5 rounded cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors" @click="selectAll">Select All</DropdownMenuItem>
                            <DropdownMenuItem class="text-xs px-2 py-1.5 rounded cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors" @click="selectNone">Select None</DropdownMenuItem>
                            <DropdownMenuItem class="text-xs px-2 py-1.5 rounded cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors" @click="invertSelection">Invert Selection</DropdownMenuItem>
                            <DropdownMenuSeparator class="my-1 h-px bg-border" />
                            <DropdownMenuItem class="text-xs px-2 py-1.5 rounded cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors"
                                :disabled="!hasSelection || processingStats.isActive || isAnyLoading" @click="bulkStart">Start Selected</DropdownMenuItem>
                            <DropdownMenuItem class="text-xs px-2 py-1.5 rounded cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors"
                                :disabled="!hasSelection" @click="bulkStop">Stop Selected</DropdownMenuItem>
                            <DropdownMenuItem class="text-xs px-2 py-1.5 rounded cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors"
                                :disabled="!hasSelection || processingStats.isActive" @click="bulkReset">Reset Selected</DropdownMenuItem>
                            <DropdownMenuSeparator class="my-1 h-px bg-border" />
                            <DropdownMenuItem class="text-xs px-2 py-1.5 rounded cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors"
                                :disabled="!hasSelection || processingStats.isActive" @click="bulkEnable">Enable Selected</DropdownMenuItem>
                            <DropdownMenuItem class="text-xs px-2 py-1.5 rounded cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors"
                                :disabled="!hasSelection || processingStats.isActive" @click="bulkDisable">Disable Selected</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenuRoot>
                </div>
            </div>

            <!-- Empty state -->
            <div v-if="!hasSources" class="text-center text-muted-foreground py-8 border rounded-lg">
                Add at least one source to see episodes.
            </div>

            <template v-else>
                <div ref="episodeListRef" class="border rounded-lg overflow-hidden">
                    <EpisodeQueueItem
                        v-for="(episode, index) in episodes"
                        :key="episode.id"
                        :episode="episode"
                        :index="index"
                        :items="episodes"
                        :selected="selectedIds.has(episode.id)"
                        :expanded="expandedEpisodeId === episode.id"
                        @toggle-enabled="toggleEnabled"
                        @start-processing="startProcessing"
                        @restart-processing="restartProcessing"
                        @stop-processing="stopProcessing"
                        @reset-episode="resetEpisode"
                        @clear-filename-override="clearFilenameOverride"
                        @set-filename-override="setFilenameOverride"
                        @toggle-overwrite="handleToggleOverwrite"
                        @toggle-chapters="handleToggleChapters"
                        @toggle-expand="handleToggleExpand"
                        @toggle-select="toggleSelect"
                    />
                </div>

                <div v-if="unassignedCount > 0" class="flex items-center gap-2 p-3 rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950 text-sm">
                    <span class="text-yellow-700 dark:text-yellow-300">
                        ⚠ {{ unassignedCount }} episode(s) could not be automatically assigned.
                    </span>
                </div>
            </template>
    </div>
</template>
