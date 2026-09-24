<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport, ScrollAreaCorner } from 'reka-ui';
import { ref, nextTick } from 'vue';
import { X } from '@lucide/vue';
import MonacoJsonEditor from '@/components/editor/MonacoJsonEditor.vue';
import { DialogRoot, DialogContent, DialogTitle, DialogClose } from 'reka-ui';
import StreamFileRow from '@/components/source/preview/StreamFileRow.vue';
import type { FilePreviewState, FileEpisodeInfo } from '@/components/source/types/stream-match-types';

defineOptions({ name: 'StreamMatchPreview' });

export type { FilePreviewState, FileEpisodeInfo };

interface Props {
    files: FilePreviewState[];
    class?: string;
    sourceDirectory: string;
    perFileMetadata?: Record<string, boolean>;
    perFileChapters?: Record<string, boolean>;
    perFileChapterDelay?: Record<string, number>;
    perFileExcluded?: Record<string, boolean>;
    excludedTracksByFile?: Record<string, Set<number>>;
    perFileEpisodeInfo?: Record<string, FileEpisodeInfo | null>;
    perFileSeasonOverride?: Record<string, number | null>;
    perFileEpisodeOverride?: Record<string, number | null>;
    perTrackModifiersByFile?: Record<string, Record<number, Record<string, unknown>>>;
}

const props = withDefaults(defineProps<Props>(), {
    perFileEpisodeInfo: () => ({}),
    perFileSeasonOverride: () => ({}),
    perFileEpisodeOverride: () => ({}),
    perTrackModifiersByFile: () => ({}),
});

const emit = defineEmits<{
    (e: 'update:perFileMetadata', file: string, val: boolean): void;
    (e: 'update:perFileChapters', file: string, val: boolean): void;
    (e: 'update:perFileChapterDelay', file: string, val: number): void;
    (e: 'toggle-track-exclude', file: string, trackIdx: number): void;
    (e: 'toggle-source-exclude', file: string): void;
    (e: 'update:perFileSeasonOverride', file: string, val: number | null): void;
    (e: 'update:perFileEpisodeOverride', file: string, val: number | null): void;
    (e: 'update:perTrackModifier', file: string, trackIdx: number, field: string, val: unknown): void;
    (e: 'clearPerTrackModifier', file: string, trackIdx: number, field: string): void;
}>();

// ─── File-level expand state (tracking which files are expanded) ──

const expandedFile = ref<string | null>(null);
const expandedTrackKeys = ref<Set<string>>(new Set());
// Per-file section expand state (episode info, container, chapters)
const expandedEpisodeSections = ref<Set<string>>(new Set());
const trackContainerHeight = ref<number>(300);
// ─── Raw StreamInfo / MediaInfo dialog ──────────────────────

const rawDialogOpen = ref(false);
const rawDialogFile = ref<string | null>(null);
const rawDialogData = ref<unknown>(null);
const rawDialogRevealIndex = ref<number | null>(null);

function openRawDialog(file: string, data: unknown, trackIndex?: number) {
    rawDialogFile.value = file;
    rawDialogData.value = data;
    rawDialogRevealIndex.value = trackIndex ?? null;
    rawDialogOpen.value = true;
}

// ─── Expand / collapse ────────────────────────────────────

function toggleFile(file: string) {
    if (expandedFile.value === file) {
        expandedFile.value = null;
        // Reset all inner expand state so that re-expanding shows the rows collapsed.
        expandedTrackKeys.value = new Set();
        expandedEpisodeSections.value = new Set();
    } else {
        expandedFile.value = file;
        expandedTrackKeys.value = new Set();
    }
}

function isExpanded(file: string): boolean {
    return expandedFile.value === file;
}

function toggleTrack(file: string, trackIdx: number) {
    const key = `${file}::${trackIdx}`;
    const next = new Set(expandedTrackKeys.value);
    if (next.has(key)) {
        next.delete(key);
    } else {
        next.add(key);
    }
    expandedTrackKeys.value = next;
}

// ─── Type badge click → expand file + scroll to first matched track ──

function handleTypeBadgeClick(file: string, type: string) {
    if (!isExpanded(file)) {
        toggleFile(file);
    }

    const fileState = props.files.find(f => f.file === file);
    const matchedTracksOfType = fileState?.tracks.filter(t => t.type === type && t.matched) ?? [];
    if (matchedTracksOfType.length === 0) return;

    for (const track of fileState?.tracks ?? []) {
        const key = `${file}::${track.index}`;
        if (expandedTrackKeys.value.has(key)) {
            const next = new Set(expandedTrackKeys.value);
            next.delete(key);
            expandedTrackKeys.value = next;
        }
    }
    for (const track of matchedTracksOfType) {
        const key = `${file}::${track.index}`;
        const next = new Set(expandedTrackKeys.value);
        next.add(key);
        expandedTrackKeys.value = next;
    }

    nextTick(() => {
        const firstTrack = matchedTracksOfType[0];
        if (firstTrack) {
            const el = document.querySelector<HTMLElement>(
                `[data-stream-type="${type}"][data-stream-index="${firstTrack.index}"]`,
            );
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
}

// ─── Episode badge click → expand file + scroll to episode info ──

function handleChaptersBadgeClick(file: string) {
    if (!isExpanded(file)) {
        toggleFile(file);
    }

    // Collapse all track expansions
    const fileState = props.files.find(f => f.file === file);
    for (const track of fileState?.tracks ?? []) {
        const key = `${file}::${track.index}`;
        if (expandedTrackKeys.value.has(key)) {
            const next = new Set(expandedTrackKeys.value);
            next.delete(key);
            expandedTrackKeys.value = next;
        }
    }

    // Expand chapters section
    const sects = new Set(expandedEpisodeSections.value);
    sects.add(`${file}::chapters`);
    sects.delete(`${file}::episode-info`);
    sects.delete(`${file}::container`);
    expandedEpisodeSections.value = sects;

    nextTick(() => {
        const el = document.querySelector<HTMLElement>('[data-stream-type="chapters"]');
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

function handleEpisodeBadgeClick(file: string) {
    if (!isExpanded(file)) {
        toggleFile(file);
    }

    const fileState = props.files.find(f => f.file === file);
    for (const track of fileState?.tracks ?? []) {
        const key = `${file}::${track.index}`;
        if (expandedTrackKeys.value.has(key)) {
            const next = new Set(expandedTrackKeys.value);
            next.delete(key);
            expandedTrackKeys.value = next;
        }
    }

    // Expand episode info section
    const sects = new Set(expandedEpisodeSections.value);
    sects.add(`${file}::episode-info`);
    sects.delete(`${file}::chapters`);
    sects.delete(`${file}::container`);
    expandedEpisodeSections.value = sects;

    nextTick(() => {
        const el = document.querySelector<HTMLElement>('[data-stream-type="episode"]');
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

// ─── Resize handle ─────────────────────────────────────────

const isDraggingResize = ref(false);

function onResizeStart(e: MouseEvent) {
    isDraggingResize.value = true;
    const startY = e.clientY;
    const startHeight = trackContainerHeight.value;

    function onMove(ev: MouseEvent) {
        if (!isDraggingResize.value) return;
        const delta = startY - ev.clientY;
        trackContainerHeight.value = Math.max(120, Math.min(800, startHeight - delta));
    }

    function onUp() {
        isDraggingResize.value = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}
</script>

<template>
    <div :class="props.class">
        <div v-if="props.files.length === 0" class="text-sm text-muted-foreground py-2 text-center">
            No files loaded.
        </div>
        <div v-else class="space-y-1">
            <div v-for="fileState in props.files" :key="fileState.file">
                <StreamFileRow
                    :file-state="fileState"
                    :source-directory="sourceDirectory"
                    :per-file-metadata="perFileMetadata"
                    :per-file-chapters="perFileChapters"
                    :per-file-chapter-delay="perFileChapterDelay"
                    :per-file-excluded="perFileExcluded"
                    :per-file-episode-info="perFileEpisodeInfo"
                    :per-file-season-override="perFileSeasonOverride"
                    :per-file-episode-override="perFileEpisodeOverride"
                    :excluded-tracks-by-file="excludedTracksByFile"
                    :per-track-modifiers-by-file="perTrackModifiersByFile"
                    :expanded="isExpanded(fileState.file)"
                    :expanded-track-keys="expandedTrackKeys"
                    :expanded-sections="expandedEpisodeSections"
                    :track-container-height="trackContainerHeight"
                    @toggle-file="toggleFile"
                    @toggle-track="toggleTrack"
                    @toggle-track-exclude="(f, idx) => emit('toggle-track-exclude', f, idx)"
                    @toggle-source-exclude="(f) => emit('toggle-source-exclude', f)"
                    @toggle-section="(f, section) => { const s = new Set(expandedEpisodeSections); s.has(`${f}::${section}`) ? s.delete(`${f}::${section}`) : s.add(`${f}::${section}`); expandedEpisodeSections = s; }"
                    @type-badge-click="handleTypeBadgeClick"
                    @episode-badge-click="handleEpisodeBadgeClick"
                    @chapters-badge-click="handleChaptersBadgeClick"
                    @update:per-file-metadata="(f, v) => emit('update:perFileMetadata', f, v)"
                    @update:per-file-chapters="(f, v) => emit('update:perFileChapters', f, v)"
                    @update:per-file-chapter-delay="(f, v) => emit('update:perFileChapterDelay', f, v)"
                    @update:per-file-season-override="(f, v) => emit('update:perFileSeasonOverride', f, v)"
                    @update:per-file-episode-override="(f, v) => emit('update:perFileEpisodeOverride', f, v)"
                    @update:per-track-modifier="(f, idx, field, val) => emit('update:perTrackModifier', f, idx, field, val)"
                    @clear-per-track-modifier="(f, idx, field) => emit('clearPerTrackModifier', f, idx, field)"
                    @open-raw-dialog="openRawDialog"
                />

                <!-- Resize handle for track container (visible only when expanded) -->
                <div v-if="fileState.tracks.length > 0 && isExpanded(fileState.file)"
                    class="relative flex items-center justify-center h-3 cursor-row-resize select-none bg-accent/30 hover:bg-accent/60 active:bg-accent/80 transition-colors"
                    @mousedown.stop="onResizeStart">
                    <div class="flex items-center gap-1.5 opacity-40">
                        <span class="block w-6 h-px bg-muted-foreground/30"></span>
                        <span class="block w-6 h-px bg-muted-foreground/30"></span>
                        <span class="block w-6 h-px bg-muted-foreground/30"></span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Raw StreamInfo + MediaInfo Dialog -->
        <DialogRoot v-model:open="rawDialogOpen">
            <DialogContent class="fixed left-1/2 top-1/2 z-50 grid w-full max-w-[90vw] max-h-[80vh] gap-4 border bg-background p-6 shadow-lg sm:rounded-lg -translate-x-1/2 -translate-y-1/2">
                <DialogTitle class="text-sm font-semibold">
                    Raw Data – {{ rawDialogFile }}
                </DialogTitle>
                <ScrollAreaRoot class="flex flex-col min-h-0 overflow-hidden" type="always">
                    <ScrollAreaViewport class="flex-1 min-h-0">
                        <div>
                            <MonacoJsonEditor v-if="rawDialogData" :model-value="rawDialogData" :reveal-index="rawDialogRevealIndex"
                                class="flex-1 min-h-0" />
                            <p v-else class="text-sm text-muted-foreground">No data available.</p>
                        </div>
                    </ScrollAreaViewport>
                    <ScrollAreaScrollbar orientation="vertical" class="group w-2.5 bg-muted/20">
                        <ScrollAreaThumb class="bg-muted-foreground/50 group-hover:bg-muted-foreground/80 rounded-full transition-colors" />
                    </ScrollAreaScrollbar>
                    <ScrollAreaCorner />
                </ScrollAreaRoot>
                <DialogClose class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100">
                    <X class="h-4 w-4" />
                </DialogClose>
            </DialogContent>
        </DialogRoot>
    </div>
</template>
