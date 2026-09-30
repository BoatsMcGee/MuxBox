<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue';
import { TooltipRoot, TooltipTrigger, TooltipContent } from 'reka-ui';
import { DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from 'reka-ui';
import { CheckboxRoot, CheckboxIndicator } from 'reka-ui';
import { makeDraggable } from '@vue-dnd-kit/core';
import sanitize from 'sanitize-filename';
import { X, GripVertical, Package, BookOpen, ChevronDown, ChevronUp, Pen, Check, AlertTriangle, Play, RotateCw, Square, MoreVertical } from '@lucide/vue';
import { join } from '@app/preload';
import type { EpisodeStatus } from '@/types/episode';
import type { StreamType } from '@/lib/stream-types';
import { useEpisodeQueueStore } from '@/stores/useEpisodeQueueStore';
import { useProjectStore } from '@/stores/useProjectStore';
import StreamTypeBadge from '@/components/source/shared/StreamTypeBadge.vue';
import { STREAM_TYPE_INFO } from '@/lib/stream-types';
import { buildBadgeCounts } from '@/lib/stream-types';
import EpisodeTrackRow from './EpisodeTrackRow.vue';
import type { EpisodeProgress } from '@/stores/useEpisodeQueueStore';
import { useLongPress } from '@/composables/useLongPress';

export interface TrackConfigItem {
    type: 'video' | 'audio' | 'subtitle' | 'attachment';
    index: number;
    enabled: boolean;
    title?: string;
    language?: string;
    codec?: string;
    /** Disposition names as strings (e.g. "Default", "Forced", "Hearing Impaired"). */
    dispositionFlags: string[];
    /** The actual stream index in the source file (from StreamInfo.index) */
    fileStreamIndex: number;
    /** Whether this track was matched by a source config item */
    matched: boolean;
    /** Primary file name for attachments (from metadata.filename), fallback for other types */
    filename?: string;
    /** MIME type for attachments (from metadata.mimetype) */
    mimetype?: string;

    // ── Original source values (for reset-to-original) ──
    /** Original title from source metadata before any overrides. */
    originalTitle?: string;
    /** Original language from source metadata before any overrides. */
    originalLanguage?: string;
    /** Original disposition flags from source before any overrides. */
    originalDispositions: string[];
    /** The source file path (demuxerMapKey) this track originated from — used for override keying. */
    demuxerMapKey: string;
    /** Original delay in ms from source perTrackModifiers (fallback 0). */
    originalDelay: number;
    /** Current effective delay (user override, or fallback to original). */
    currentDelay: number;
    /** All original source metadata tags (title, language, and custom keys). */
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

/** A single source's chapters with its own enabled state. */
export interface SourceChapterGroup {
    /** Unique identifier within the episode (source index). */
    sourceIdx: number;
    /** Display label (filename). */
    label: string;
    /** Chapter entries for this source. */
    chapters: ChapterEntry[];
    /** Whether chapters from this source are enabled. */
    enabled: boolean;
    /** Chapter delay in milliseconds. */
    delay: number;
}

export interface EpisodeQueueItemData {
    id: string;
    seasonNumber: number;
    episodeNumber: number;
    title: string;
    sourceFile: string;
    sourceDirectory: string;
    sourceIndex: number;
    /** Additional source contributions when the same episode appears in multiple source directories */
    additionalSources?: { sourceFile: string; sourceDirectory: string; sourceIndex: number }[];
    enabled: boolean;
    status: EpisodeStatus;
    progress: number;
    currentStep: string;
    streamCounts: { video: number; audio: number; subtitle: number; attachment: number };
    tracks: TrackConfigItem[];
    /** Preview of the output filename, computed from real stream data */
    outputFilenamePreview?: string;
    /** Cursor to the source config's stream items for matching display */
    matchedVideo: number;
    matchedAudio: number;
    matchedSubtitle: number;
    matchedAttachment: number;
    /** Per-source chapter groups. Each source that has chapters gets its own row. */
    sourceChapterGroups: SourceChapterGroup[];
    /** When set, the episode uses this filename (without extension) instead of the rename template. */
    filenameOverride?: string;
}

interface Props {
    episode: EpisodeQueueItemData;
    index: number;
    items: EpisodeQueueItemData[];
    selected: boolean;
    expanded: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
    (e: 'toggle-enabled', id: string): void;
    (e: 'start-processing', id: string): void;
    (e: 'restart-processing', id: string): void;
    (e: 'stop-processing', id: string): void;
    (e: 'reset-episode', id: string): void;
    (e: 'clear-filename-override', id: string): void;
    (e: 'set-filename-override', id: string, value: string): void;
    (e: 'toggle-overwrite', id: string): void;
    (e: 'toggle-chapters', id: string, sourceIdx: number): void;
    (e: 'toggle-expand', id: string): void;
    (e: 'toggle-select', id: string): void;
}>();

const itemRef = ref<HTMLDivElement | null>(null);
const queueStore = useEpisodeQueueStore();
const projectStore = useProjectStore();

const { isDragging } = makeDraggable(
    itemRef,
    { id: props.episode.id, dragHandle: '.drag-handle' },
    () => [props.index, props.items],
);

// ─── Long press for selection (header row only) ──────────────

const { isPressing, hasLongPressed, onMouseDown, onMouseUp, onMouseLeave, onTouchStart, onTouchEnd, onTouchCancel } = useLongPress({
    delay: 400,
    onLongPress: () => emit('toggle-select', props.episode.id),
    onPressStart: () => {
        // Visual feedback could be added here if needed
    },
    onPressEnd: () => {
        // Cleanup visual feedback
    },
});

// ─── Track update handlers (forwarded from EpisodeTrackRow) ─
// Completion invalidation happens in EpisodeTrackRow.updateTrackOverride,
// which every one of these emits follows, including tag/mime/filename edits
// that never reach the parent.

function handleTrackUpdate(trackIndex: number, field: 'title' | 'language', value: string | undefined) {
    const track = props.episode.tracks[trackIndex];
    if (!track) return;
    if (field === 'title') track.title = value;
    if (field === 'language') track.language = value;
}

function handleTrackDelayUpdate(trackIndex: number, delayMs: number) {
    const track = props.episode.tracks[trackIndex];
    if (!track) return;
    track.currentDelay = delayMs;
}

function handleTrackDispositionUpdate(trackIndex: number, dispKey: number, enabled: boolean) {
    const track = props.episode.tracks[trackIndex];
    if (!track) return;

    // Special case: dispKey -1 means clear all disposition overrides
    if (dispKey === -1) {
        track.dispositionFlags = [...(track.muxedDispositions ?? [])];
        return;
    }

    const dispNames: Record<number, string> = {
        1: 'Default', 2: 'Dub', 4: 'Original', 8: 'Comment',
        16: 'Lyrics', 32: 'Karaoke', 64: 'Forced', 128: 'Hearing Impaired',
        256: 'Visual Impaired', 512: 'Clean Effects', 1024: 'Attached Picture',
        2048: 'Timed Thumbnails', 4096: 'Non-Diegetic', 65536: 'Captions',
        131072: 'Descriptions', 262144: 'Metadata', 524288: 'Dependent',
        1048576: 'Still Image', 2097152: 'Multilayer',
    };
    const label = dispNames[dispKey];
    if (!label) return;
    if (enabled) {
        if (!track.dispositionFlags.includes(label)) {
            track.dispositionFlags = [...track.dispositionFlags, label];
        }
    } else {
        track.dispositionFlags = track.dispositionFlags.filter(d => d !== label);
    }
}

// ─── Expand state (managed by parent accordion) ──────────────

const containerExpanded = ref(false);
const chaptersExpanded = ref(false);
const expandedTracks = ref<Set<number>>(new Set());

function toggleExpand() {
    emit('toggle-expand', props.episode.id);
}

// When the episode is collapsed, reset all inner expand state so that
// re-expanding shows the rows in their collapsed state (matches Stream Match Preview).
watch(
    () => props.expanded,
    (expanded) => {
        if (!expanded) {
            expandedTracks.value = new Set();
            containerExpanded.value = false;
            chaptersExpanded.value = false;
        }
    },
);

function handleTypeBadgeClick(type: StreamType) {
    if (!props.expanded) {
        emit('toggle-expand', props.episode.id);
    }

    if (type === 'chapters') {
        // Collapse all track rows and container, expand chapters
        expandedTracks.value = new Set();
        containerExpanded.value = false;
        chaptersExpanded.value = true;
        nextTick(() => {
            document.querySelector<HTMLElement>('[data-queue-section="chapters"]')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return;
    }

    const matchedOfType = props.episode.tracks.filter(t => t.type === type && t.matched);
    if (matchedOfType.length === 0) return;

    // Collapse all tracks first, then expand all matched tracks of this type
    expandedTracks.value = new Set(matchedOfType.map(t => t.index));

    nextTick(() => {
        const first = matchedOfType[0];
        const el = document.querySelector<HTMLElement>(
            `[data-stream-type="${type}"][data-stream-index="${first.index}"]`,
        );
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

function handleTrackToggleExpand(trackIndex: number) {
    const next = new Set(expandedTracks.value);
    if (next.has(trackIndex)) next.delete(trackIndex);
    else next.add(trackIndex);
    expandedTracks.value = next;
}

// ─── Filename editing ───────────────────────────────────────

const editingFilename = ref(false);
const filenameEditValue = ref('');
const filenameInputRef = ref<HTMLInputElement | null>(null);

/** Characters that would be stripped by sanitize-filename. */
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/;

/** Returns an error message if the current edit value contains invalid characters, else empty string. */
const filenameEditError = computed(() => {
    const v = filenameEditValue.value;
    if (!v) return '';
    const sanitized = sanitize(v);
    if (sanitized !== v) {
        const bad = v.split('').filter(ch => INVALID_FILENAME_CHARS.test(ch));
        const unique = [...new Set(bad)];
        return `Invalid character${unique.length > 1 ? 's' : ''}: ${unique.map(c => `"${c}"`).join(', ')}`;
    }
    return '';
});

function startFilenameEdit() {
    filenameEditValue.value = effectiveFilename.value;
    editingFilename.value = true;
    nextTick(() => {
        filenameInputRef.value?.focus();
    });
}

function commitFilenameEdit() {
    if (editingFilename.value) {
        const val = filenameEditValue.value.trim();
        if (val && val !== (props.episode.filenameOverride ?? props.episode.outputFilenamePreview?.replace(/\.mkv$/, ''))) {
            emit('set-filename-override', props.episode.id, val);
        }
        editingFilename.value = false;
    }
}

function cancelFilenameEdit() {
    editingFilename.value = false;
}

function clearFilenameEdit() {
    // Clear the override and exit editing mode — the episode will revert to rename template
    emit('clear-filename-override', props.episode.id);
    editingFilename.value = false;
}

// ─── Processing state from store ───────────────────────────

const processingProgress = computed<EpisodeProgress>(() => queueStore.getProgress(props.episode.id));
const isProcessing = computed(() =>
    processingProgress.value.status === 'preprocessing' || processingProgress.value.status === 'muxing',
);
const isCompleted = computed(() => processingProgress.value.status === 'completed');
const hasError = computed(() => processingProgress.value.status === 'error');
const isSkipped = computed(() => processingProgress.value.status === 'skipped');

/** Status from processing progress overrides the episode's static status. */
const effectiveStatus = computed(() => {
    const ps = processingProgress.value.status;
    if (ps === 'idle' || ps === 'pending') return props.episode.status;
    return ps;
});

/** Format milliseconds to a human-readable duration string (e.g. "1m 23s"). */
function formatMs(ms: number): string {
    if (ms < 1000) return '<1s';
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

/** Format packets per second to a short string. */
function formatPps(pps: number): string {
    if (pps >= 1_000_000) return `${(pps / 1_000_000).toFixed(1)}M/s`;
    if (pps >= 1_000) return `${(pps / 1_000).toFixed(1)}K/s`;
    return `${pps.toFixed(0)}/s`;
}

/** Progress detail line (stats during muxing). */
const progressDetail = computed(() => {
    const p = processingProgress.value;
    const parts: string[] = [];
    if (p.elapsedMs != null && p.elapsedMs > 0) parts.push(`Elapsed ${formatMs(p.elapsedMs)}`);
    if (p.estimatedRemainingMs != null && p.estimatedRemainingMs > 0) parts.push(`ETA ${formatMs(p.estimatedRemainingMs)}`);
    if (p.totalPacketsWritten != null && p.totalPacketsWritten > 0) {
        let s = `${p.totalPacketsWritten.toLocaleString()} pkts`;
        if (p.pps != null && p.pps > 0) s += ` (${formatPps(p.pps)})`;
        parts.push(s);
    }
    if (p.totalTimecode) parts.push(`⏱ ${p.totalTimecode}`);
    return parts.join(' | ');
});

function getStatusBadgeClass(status: string): string {
    switch (status) {
        case 'loading': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
        case 'pending': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
        case 'unassigned': return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
        case 'preprocessing':
        case 'muxing':
        case 'processing': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
        case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
        case 'error': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
        case 'skipped': return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500';
        default: return 'bg-gray-100 text-gray-800';
    }
}

function getProgressColor(status: string): string {
    switch (status) {
        case 'loading':
        case 'preprocessing':
        case 'muxing': return 'bg-blue-500';
        case 'completed': return 'bg-green-500';
        case 'error': return 'bg-red-500';
        case 'skipped': return 'bg-gray-400';
        default: return 'bg-gray-300';
    }
}

/** Extract last path component (basename) — works for both / and \ */
function basename(p: string): string {
    const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return idx >= 0 ? p.slice(idx + 1) : p;
}

/** Stream counts for badge display — totals only. */
/** Total enabled chapter count across all sources. */
const chapterCount = computed(() =>
    props.episode.sourceChapterGroups
        .filter(g => g.enabled)
        .reduce((sum, g) => sum + g.chapters.length, 0),
);

const badgeCounts = computed(() => {
    return buildBadgeCounts(
        props.episode.streamCounts,
        props.episode.sourceChapterGroups.filter(g => g.enabled).reduce((sum, g) => sum + g.chapters.length, 0),
        props.episode.sourceChapterGroups.some(g => g.enabled),
    );
});

/** The effective filename to display (override or computed) — always just the basename. */
const effectiveFilename = computed(() => {
    const raw = props.episode.filenameOverride ?? props.episode.outputFilenamePreview?.replace(/\.mkv$/, '') ?? props.episode.sourceFile.replace(/\.[^.]+$/, '');
    return basename(raw);
});

/** Full source path for the tooltip. */
const tooltipPath = computed(() =>
    `${props.episode.sourceDirectory}\\${props.episode.sourceFile}`,
);

/** Full muxed output path for the filename tooltip. */
const outputPath = computed(() => {
    const dir = projectStore.currentProject?.outputDirectory;
    // outputFilenamePreview already includes the relative path (series/season/filename.mkv)
    const preview = props.episode.outputFilenamePreview;
    if (dir && preview) return `${dir}\\${preview}`;
    if (dir) return `${dir}\\${effectiveFilename.value}.mkv`;
    return tooltipPath.value;
});

/** The per-episode overwrite flag. */
const episodeOverwrite = computed(() => {
    const project = projectStore.currentProject;
    if (!project) return false;
    const perFile = (project.muxOptions as Record<string, unknown>)?.perFileOverwrite as Record<string, boolean> | undefined;
    return perFile?.[props.episode.id] ?? false;
});

function handleStart() {
    if (props.episode.enabled && !isProcessing.value && !isCompleted.value && !isSkipped.value && !hasError.value && effectiveStatus.value !== 'loading') {
        emit('start-processing', props.episode.id);
    }
}

function handleRestart() {
    if (props.episode.enabled && !isProcessing.value && effectiveStatus.value !== 'loading') {
        emit('restart-processing', props.episode.id);
    }
}

function handleReset() {
    if (!isProcessing.value) {
        emit('reset-episode', props.episode.id);
    }
}

function handleStop() {
    emit('stop-processing', props.episode.id);
}
</script>

<template>
    <div
        ref="itemRef"
        class="border-b last:border-b-0 transition-colors"
        :class="{
            'opacity-50': isDragging,
            'bg-accent/50': selected,
            'opacity-40': !episode.enabled,
        }"
    >
        <!-- Header row: click to expand/collapse, long press to toggle selection -->
        <div
            class="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors duration-150"
            :class="{ 'opacity-70 scale-[0.99]': isPressing && !hasLongPressed, 'bg-accent/30': hasLongPressed }"
            @click.stop="toggleExpand"
            @mousedown="onMouseDown"
            @mouseup="onMouseUp"
            @mouseleave="onMouseLeave"
            @touchstart="onTouchStart"
            @touchend="onTouchEnd"
            @touchcancel="onTouchCancel"
        >
            <!-- Drag handle -->
            <TooltipRoot :delay-duration="200">
                <TooltipTrigger as-child>
                    <span
                        class="drag-handle shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing select-none touch-none flex items-center justify-center w-4 h-full"
                        @click.stop
                    >
                        <GripVertical class="w-3.5 h-3.5" />
                    </span>
                </TooltipTrigger>
                <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                    Drag to reorder
                </TooltipContent>
            </TooltipRoot>

            <!-- S##E## badge -->
            <TooltipRoot v-if="!editingFilename" :delay-duration="400">
                <TooltipTrigger as-child>
                    <span
                        class="shrink-0 font-mono text-xs bg-muted/50 rounded px-1 py-0.5 cursor-default transition-colors select-none"
                        :class="{
                            'text-green-700 dark:text-green-300': episode.episodeNumber > 0,
                            'text-muted-foreground': episode.episodeNumber === 0,
                        }"
                    >
                        S{{ String(episode.seasonNumber).padStart(2, '0') }}E{{ String(episode.episodeNumber).padStart(2, '0') }}
                    </span>
                </TooltipTrigger>
                <TooltipContent side="top" class="z-50 max-w-[260px] rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                    {{ episode.title || `Season ${episode.seasonNumber}, Episode ${episode.episodeNumber}` }}
                </TooltipContent>
            </TooltipRoot>

            <!-- Status badge (reflects live processing state) -->
            <template v-if="!editingFilename">
            <TooltipRoot v-if="effectiveStatus === 'skipped'" :delay-duration="200">
                <TooltipTrigger as-child>
                    <span
                        class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
                        :class="getStatusBadgeClass(effectiveStatus)"
                    >
                        {{ effectiveStatus }}
                    </span>
                </TooltipTrigger>
                <TooltipContent side="top" class="z-50 max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                    File already exists and overwriting is disabled
                </TooltipContent>
            </TooltipRoot>
            <span v-else-if="effectiveStatus === 'loading'"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
                :class="getStatusBadgeClass(effectiveStatus)"
            >
                <span class="inline-block w-3 h-3 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
                loading
            </span>
            <span v-else
                class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
                :class="getStatusBadgeClass(effectiveStatus)"
            >
                {{ effectiveStatus }}
            </span>
            </template>

            <!-- Editable filename (just the filename, no folder) -->
            <div class="min-w-0 flex-1 flex items-center gap-1" @click.stop="editingFilename || toggleExpand()">
                <template v-if="editingFilename">
                    <TooltipRoot :open="!!filenameEditError" :delay-duration="0">
                        <TooltipTrigger as-child>
                            <span class="flex-1 flex items-center gap-1 min-w-0">
                                <span class="relative flex-1 min-w-0">
                                    <input
                                        ref="filenameInputRef"
                                        class="w-full h-6 px-1.5 pr-6 text-xs border rounded bg-background font-mono"
                                        :class="{ 'border-destructive': !!filenameEditError }"
                                        v-model="filenameEditValue"
                                        placeholder="filename"
                                        @keydown.enter.prevent="commitFilenameEdit"
                                        @keydown.space.stop
                                        @keydown.escape.prevent="cancelFilenameEdit"
                                        @blur="commitFilenameEdit"
                                    />
                                    <TooltipRoot :delay-duration="200">
                                        <TooltipTrigger as-child>
                                            <button
                                                class="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                                @mousedown.prevent
                                                @click.stop="clearFilenameEdit"
                                            >
                                                <X class="w-3 h-3" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                            Clear override (use rename template)
                                        </TooltipContent>
                                    </TooltipRoot>
                                </span>
                                <AlertTriangle v-if="filenameEditError" class="w-3.5 h-3.5 shrink-0 text-destructive" />
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" class="z-50 max-w-[300px] rounded-lg border border-destructive bg-background px-3 py-1.5 text-xs text-foreground shadow-md">
                            {{ filenameEditError }}
                        </TooltipContent>
                    </TooltipRoot>
                    <span class="text-xs text-muted-foreground shrink-0">.mkv</span>
                </template>
                <template v-else>
                    <TooltipRoot :delay-duration="400">
                        <TooltipTrigger as-child>
                            <span class="text-xs truncate rounded px-0.5 -ml-0.5 cursor-default"
                                :class="episode.filenameOverride ? 'text-orange-700 dark:text-orange-300 font-medium' : 'text-foreground'">
                                {{ effectiveFilename }}.mkv
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" class="z-50 max-w-[400px] rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md break-all">
                            {{ outputPath }}
                        </TooltipContent>
                    </TooltipRoot>
                    <TooltipRoot :delay-duration="200">
                        <TooltipTrigger as-child>
                            <button
                                class="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                :disabled="isProcessing"
                                @click.stop="startFilenameEdit">
                                <Pen class="w-3 h-3" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                            Edit filename
                        </TooltipContent>
                    </TooltipRoot>
                </template>
            </div>

            <!-- Stream type badges (total variant, coloured pills with stream count) -->
            <div v-if="!editingFilename" class="flex items-center shrink-0" @click.stop>
                <StreamTypeBadge
                    :counts="badgeCounts"
                    variant="total"
                    :on-click-type="handleTypeBadgeClick"
                    class="gap-1"
                />
            </div>

            <!-- Start / Restart / Stop button -->
            <div v-if="!editingFilename" class="flex items-center shrink-0" @click.stop>
                <TooltipRoot v-if="!isProcessing && !isCompleted && !isSkipped && !hasError" :delay-duration="200">
                    <TooltipTrigger as-child>
                        <button
                            class="p-1 rounded text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/50 hover:bg-green-200 dark:hover:bg-green-800/50 disabled:opacity-50 transition-colors"
                            :disabled="!episode.enabled"
                            @click.stop="handleStart">
                            <Play class="w-3.5 h-3.5" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                        Start muxing
                    </TooltipContent>
                </TooltipRoot>
                <TooltipRoot v-if="!isProcessing && (isCompleted || isSkipped || hasError)" :delay-duration="200">
                    <TooltipTrigger as-child>
                        <button
                            class="p-1 rounded text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/50 hover:bg-green-200 dark:hover:bg-green-800/50 disabled:opacity-50 transition-colors"
                            :disabled="!episode.enabled"
                            @click.stop="handleRestart">
                            <RotateCw class="w-3.5 h-3.5" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                        Restart muxing
                    </TooltipContent>
                </TooltipRoot>
                <TooltipRoot v-if="isProcessing" :delay-duration="200">
                    <TooltipTrigger as-child>
                        <button
                            class="p-1 rounded text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-800/50 transition-colors"
                            @click.stop="handleStop">
                            <Square class="w-3.5 h-3.5" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                        Stop muxing
                    </TooltipContent>
                </TooltipRoot>
            </div>

            <!-- Overflow menu (⋮) -->
            <DropdownMenuRoot v-if="!editingFilename">
                <DropdownMenuTrigger as-child>
                    <button
                        class="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        @click.stop>
                        <MoreVertical class="w-4 h-4" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="end" :side-offset="4"
                    class="z-50 min-w-36 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
                    <DropdownMenuItem class="text-xs px-2 py-1.5 rounded cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-2"
                        @click.stop="$emit('toggle-select', episode.id)">
                        <CheckboxRoot :checked="selected" class="inline-flex items-center justify-center w-4 h-4 rounded-[3px] border shrink-0 transition-colors data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground data-[state=unchecked]:border-input">
                            <CheckboxIndicator>
                                <Check class="w-3.5 h-3.5" stroke-width="3" />
                            </CheckboxIndicator>
                        </CheckboxRoot>
                        Select
                    </DropdownMenuItem>
                    <DropdownMenuSeparator class="my-1 h-px bg-border" />
                    <DropdownMenuItem class="text-xs px-2 py-1.5 rounded cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-2"
                        @click.stop="$emit('toggle-overwrite', episode.id)">
                        <span class="w-3.5 h-3.5 inline-flex items-center justify-center border rounded"
                            :class="episodeOverwrite ? 'bg-primary border-primary' : 'border-input'">
                            <Check v-if="episodeOverwrite" class="w-2.5 h-2.5 text-primary-foreground" stroke-width="3" />
                        </span>
                        Overwrite
                    </DropdownMenuItem>
                    <DropdownMenuSeparator class="my-1 h-px bg-border" />
                    <DropdownMenuItem class="text-xs px-2 py-1.5 rounded cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors"
                        :disabled="isProcessing"
                        @click.stop="handleReset">
                        Reset
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenuRoot>

            <!-- Expand chevron (just a visual indicator, not a button) -->
            <span class="shrink-0 text-muted-foreground flex items-center" @click.stop="toggleExpand">
                <ChevronDown class="w-3.5 h-3.5 transition-transform duration-200"
                    :class="{ 'rotate-180': expanded }" />
            </span>
        </div>

        <!-- Progress stats line (only during processing) -->
        <div v-if="progressDetail" class="px-2 pb-0.5">
            <div class="text-[10px] text-muted-foreground font-mono truncate">
                {{ progressDetail }}
            </div>
        </div>

        <!-- Full-width thin progress bar -->
        <div v-if="isProcessing || isCompleted || hasError || isSkipped" class="w-full h-1 bg-gray-200 dark:bg-gray-700">
            <div
                class="h-1 transition-all duration-300"
                :class="getProgressColor(processingProgress.status)"
                :style="{ width: `${Math.min(100, Math.max(0, processingProgress.progress))}%` }"
            />
        </div>

        <!-- Error message -->
        <div v-if="hasError && processingProgress.error" class="px-2 pb-1">
            <div class="text-[10px] text-red-600 dark:text-red-400 truncate">
                {{ processingProgress.error }}
            </div>
        </div>

        <!-- ─── Expanded body: Container + Chapters + Tracks ─── -->
        <div v-if="expanded" class="border-t">
            <!-- Container row (styled like a track header) -->
            <button
                data-queue-section="container"
                class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-muted/30 transition-colors"
                @click.stop="containerExpanded = !containerExpanded">
                <span class="w-6 shrink-0"></span>
                <span class="inline-flex items-center justify-center w-5 h-5 rounded shrink-0" :class="STREAM_TYPE_INFO.chapters.color">
                    <Package class="w-3 h-3" />
                </span>
                <span class="font-medium">Container</span>
                <span class="flex-1"></span>
                <span class="text-xs text-muted-foreground inline-flex items-center ml-1">
                    <ChevronDown v-if="!containerExpanded" class="w-3 h-3" />
                    <ChevronUp v-else class="w-3 h-3" />
                </span>
            </button>
            <div v-if="containerExpanded" class="border-t bg-muted/30 px-4 py-2">
                <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div class="flex justify-between py-0.5">
                        <span class="text-muted-foreground">Title</span>
                        <span class="font-mono truncate max-w-[60%] text-right">{{ episode.title || '—' }}</span>
                    </div>
                </div>
            </div>

            <!-- Chapters row (styled like a track header) -->
            <button
                data-queue-section="chapters"
                class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-muted/30 transition-colors"
                @click.stop="chaptersExpanded = !chaptersExpanded">
                <span class="w-6 shrink-0"></span>
                <span class="inline-flex items-center justify-center w-5 h-5 rounded shrink-0" :class="STREAM_TYPE_INFO.chapters.color">
                    <BookOpen class="w-3 h-3" />
                </span>
                <span class="font-medium">Chapters</span>
                <!-- Chapters count badge (like a disposition badge) -->
                <span v-if="chapterCount > 0" class="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono bg-muted/30">
                    {{ chapterCount }} entr{{ chapterCount === 1 ? 'y' : 'ies' }}
                </span>
                <span v-else class="text-muted-foreground text-xs">0 entries</span>
                <span class="flex-1"></span>
                <span class="text-xs text-muted-foreground inline-flex items-center ml-1">
                    <ChevronDown v-if="!chaptersExpanded" class="w-3 h-3" />
                    <ChevronUp v-else class="w-3 h-3" />
                </span>
            </button>
            <div v-if="chaptersExpanded" class="border-t bg-muted/30 px-4 py-2">
                <div v-if="episode.sourceChapterGroups.length > 0" class="grid grid-cols-2 gap-x-6 text-xs">
                    <div v-for="group in episode.sourceChapterGroups" :key="group.sourceIdx" class="flex flex-col gap-0.5"
                        :class="{ 'opacity-40': !group.enabled }">
                        <!-- Source header: toggle + label + count -->
                        <div class="flex items-center gap-2 py-1 border-b border-border/40 mb-1">
                            <TooltipRoot>
                                <TooltipTrigger as-child>
                                    <span role="button" tabindex="0"
                                        class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
                                        :class="group.enabled ? 'text-green-600 dark:text-green-400' : 'text-destructive'"
                                        @click.stop="emit('toggle-chapters', episode.id, group.sourceIdx)">
                                        <Check v-if="group.enabled" class="w-3.5 h-3.5" />
                                        <X v-else class="w-3.5 h-3.5" />
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent side="right" class="z-50 max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                                    {{ group.enabled ? 'Click to disable chapters from this source' : 'Click to enable chapters from this source' }}
                                </TooltipContent>
                            </TooltipRoot>
                            <span class="font-medium truncate">{{ group.label }}</span>
                            <span class="text-muted-foreground shrink-0">({{ group.chapters.length }})</span>
                        </div>
                        <!-- Chapter entries -->
                        <div class="grid grid-cols-[auto_auto_1fr] gap-x-2 gap-y-0.5">
                            <template v-for="chapter in group.chapters" :key="chapter.timestamp + (chapter.title ?? '')">
                                <span class="font-mono text-right whitespace-nowrap"
                                    :class="group.delay !== 0 ? 'text-foreground' : 'text-muted-foreground'"
                                    :title="chapter.originalTimestamp ? `${chapter.originalTimestamp} → ${chapter.timestamp} (${group.delay} ms)` : chapter.timestamp">{{ chapter.originalTimestamp && group.delay !== 0 ? `${chapter.originalTimestamp} → ${chapter.timestamp}` : chapter.timestamp }}</span>
                                <span class="font-mono text-muted-foreground uppercase text-[10px]">{{ chapter.language || '—' }}</span>
                                <span class="font-mono truncate">{{ chapter.title }}</span>
                            </template>
                        </div>
                    </div>
                </div>
                <div v-else class="text-muted-foreground py-1 text-xs">No chapter data available.</div>
            </div>

            <!-- Track rows (no inner card, directly rendered like SMP) -->
            <div v-if="episode.tracks.length > 0" class="border-t">
                <div>
                    <EpisodeTrackRow
                        v-for="(track, tIdx) in episode.tracks"
                        :key="tIdx"
                        :track="track"
                        :episode-id="episode.id"
                        :source-file="join(episode.sourceDirectory, episode.sourceFile)"
                        :track-progress="processingProgress.trackProgress?.[tIdx]"
                        :expanded="expandedTracks.has(track.index)"
                        @toggle-expand="handleTrackToggleExpand"
                        @update-track="handleTrackUpdate"
                        @update-track-disposition="handleTrackDispositionUpdate"
                        @update-track-delay="handleTrackDelayUpdate"
                    />
                </div>
            </div>
            <div v-else class="px-3 py-2 text-xs text-muted-foreground border-t">
                No tracks available.
            </div>
        </div>
    </div>
</template>
