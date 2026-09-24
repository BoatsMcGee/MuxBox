<script setup lang="ts">
import { computed } from 'vue';
import { Check, X, Circle, ChevronDown, ChevronUp, Pencil, Package, BookOpen, Tv, TriangleAlert, ExternalLink } from '@lucide/vue';
import UiBadgedIcon from '@/components/ui/ui-badged-icon.vue';
import { TooltipRoot, TooltipTrigger, TooltipContent } from 'reka-ui';
import StreamTypeBadge from '@/components/source/shared/StreamTypeBadge.vue';
import StreamTrackRow from '@/components/source/preview/StreamTrackRow.vue';
import { computeStreamTypeCounts, STREAM_TYPE_INFO } from '@/lib/stream-types';
import { showItemInFolder } from '@app/preload';

import type { FilePreviewState, FileEpisodeInfo } from '@/components/source/types/stream-match-types';
import {
    isFileMetadataEnabled,
    isFileChaptersEnabled,
    getEpisodeInfo,
    getEffectiveSeason,
    getEffectiveEpisode,
    getEffectiveChapterDelay,
    padEpisodeNum,
    getContainerMetadata,
    getParsedChapters,
    getChapterCount,
    hasEpisodeOverride,
} from '@/components/source/composables/useStreamMatchPreview';

defineOptions({ name: 'StreamFileRow' });

interface Props {
    fileState: FilePreviewState;
    sourceDirectory: string;
    perFileMetadata?: Record<string, boolean>;
    perFileChapters?: Record<string, boolean>;
    perFileChapterDelay?: Record<string, number>;
    perFileExcluded?: Record<string, boolean>;
    perFileEpisodeInfo?: Record<string, FileEpisodeInfo | null>;
    perFileSeasonOverride?: Record<string, number | null>;
    perFileEpisodeOverride?: Record<string, number | null>;
    excludedTracksByFile?: Record<string, Set<number>>;
    perTrackModifiersByFile?: Record<string, Record<number, Record<string, unknown>>>;
    expanded: boolean;
    expandedTrackKeys: Set<string>;
    expandedSections: Set<string>;
    trackContainerHeight: number;
}

const props = withDefaults(defineProps<Props>(), {
    perFileMetadata: () => ({}),
    perFileChapters: () => ({}),
    perFileChapterDelay: () => ({}),
    perFileExcluded: () => ({}),
    perFileEpisodeInfo: () => ({}),
    perFileSeasonOverride: () => ({}),
    perFileEpisodeOverride: () => ({}),
    excludedTracksByFile: () => ({}),
    perTrackModifiersByFile: () => ({}),
});

const emit = defineEmits<{
    (e: 'toggle-file', file: string): void;
    (e: 'toggle-track', file: string, trackIdx: number): void;
    (e: 'toggle-track-exclude', file: string, trackIdx: number): void;
    (e: 'toggle-episode-info', file: string): void;
    (e: 'toggle-container', file: string): void;
    (e: 'toggle-chapters', file: string): void;
    (e: 'type-badge-click', file: string, type: string): void;
    (e: 'episode-badge-click', file: string): void;
    (e: 'chapters-badge-click', file: string): void;
    (e: 'update:perFileMetadata', file: string, val: boolean): void;
    (e: 'update:perFileChapters', file: string, val: boolean): void;
    (e: 'update:perFileChapterDelay', file: string, val: number): void;
    (e: 'toggle-source-exclude', file: string): void;
    (e: 'update:perFileSeasonOverride', file: string, val: number | null): void;
    (e: 'update:perFileEpisodeOverride', file: string, val: number | null): void;
    (e: 'update:perTrackModifier', file: string, trackIdx: number, field: string, val: unknown): void;
    (e: 'clearPerTrackModifier', file: string, trackIdx: number, field: string): void;
    (e: 'toggle-section', file: string, section: string): void;
    (e: 'open-raw-dialog', file: string, data: unknown, trackIndex: number | undefined): void;
}>();

// ─── Section expand state (managed by parent via props) ─────────

function isEpisodeInfoExpanded(): boolean {
    return props.expandedSections.has(`${props.fileState.file}::episode-info`);
}
function isContainerExpanded(): boolean {
    return props.expandedSections.has(`${props.fileState.file}::container`);
}
function isChaptersExpanded(): boolean {
    return props.expandedSections.has(`${props.fileState.file}::chapters`);
}

const epInfo = () => getEpisodeInfo(props.fileState.file, props.perFileEpisodeInfo);
const effectiveSeason = () => getEffectiveSeason(props.fileState.file, props.perFileEpisodeInfo, props.perFileSeasonOverride);
const effectiveEpisode = () => getEffectiveEpisode(props.fileState.file, props.perFileEpisodeInfo, props.perFileEpisodeOverride);
const effectiveChapterDelay = computed(() =>
    getEffectiveChapterDelay(props.fileState.file, props.perFileChapterDelay),
);
const parsedChapters = computed(() => getParsedChapters(props.fileState, effectiveChapterDelay.value));

function onSeasonOverrideInput(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    emit('update:perFileSeasonOverride', props.fileState.file, isNaN(val) ? null : val);
}

function onEpisodeOverrideInput(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    emit('update:perFileEpisodeOverride', props.fileState.file, isNaN(val) ? null : val);
}

function onChapterDelayInput(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    emit('update:perFileChapterDelay', props.fileState.file, isNaN(val) ? 0 : val);
}

const isFileExcluded = () => props.perFileExcluded?.[props.fileState.file] ?? false;

// Track container refs (used by parent for scroll-into-view)

function isTrackExpanded(trackIdx: number): boolean {
    return props.expandedTrackKeys.has(`${props.fileState.file}::${trackIdx}`);
}

function handleTypeBadgeClick(type: string) {
    if (type === 'chapters') {
        emit('chapters-badge-click', props.fileState.file);
    } else {
        emit('type-badge-click', props.fileState.file, type);
    }
}

function handleEpisodeBadgeClick() {
    emit('episode-badge-click', props.fileState.file);
}
</script>

<template>
    <div class="rounded-lg border overflow-hidden"
        :class="{
            'opacity-40': (!fileState.loading && !fileState.error && !fileState.anyMatched && fileState.tracks.length > 0) || (!fileState.loading && !fileState.error && isFileExcluded()),
        }">
        <!-- File header -->
        <button
            class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors text-sm"
            :disabled="fileState.loading"
            @click="emit('toggle-file', fileState.file)">
            <span v-if="fileState.loading"
                class="shrink-0 inline-block w-4 h-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
            <TooltipRoot v-else-if="fileState.error">
                <TooltipTrigger as-child>
                    <span class="shrink-0 text-destructive cursor-help">⚠</span>
                </TooltipTrigger>
                <TooltipContent side="right" class="z-50 max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                    Failed to load stream info
                </TooltipContent>
            </TooltipRoot>
            <TooltipRoot v-else>
                <TooltipTrigger as-child>
                    <span role="button" tabindex="0"
                        class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
                        :class="isFileExcluded()
                            ? 'text-destructive'
                            : fileState.anyMatched
                                ? 'text-green-600 dark:text-green-400'
                                : fileState.tracks.length > 0
                                    ? 'text-destructive'
                                    : 'text-muted-foreground'"
                        @click.stop="emit('toggle-source-exclude', fileState.file)">
                        <span v-if="isFileExcluded()">🛇</span>
                        <Check v-else-if="fileState.anyMatched" class="w-4 h-4" />
                        <X v-else-if="fileState.tracks.length > 0" class="w-4 h-4" />
                        <Circle v-else class="w-3 h-3" />
                    </span>
                </TooltipTrigger>
                <TooltipContent side="right" class="z-50 max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                    {{ isFileExcluded() ? 'File excluded, click to include' : 'Click to exclude this file' }}
                </TooltipContent>
            </TooltipRoot>

            <!-- Season/Episode badge -->
            <template v-if="!fileState.loading && !fileState.error">
                <template v-if="epInfo()">
                    <TooltipRoot :delay-duration="400">
                        <TooltipTrigger as-child>
                            <span role="button" tabindex="0"
                                class="shrink-0 font-mono text-xs bg-muted/50 hover:bg-muted/70 rounded px-1 py-0.5 cursor-pointer transition-colors"
                                :class="{
                                    'text-green-700 dark:text-green-300': fileState.anyMatched,
                                    'text-muted-foreground': !fileState.anyMatched,
                                }"
                                @click.stop="handleEpisodeBadgeClick">
                                S{{ padEpisodeNum(effectiveSeason()!) }}E{{ padEpisodeNum(effectiveEpisode()!) }}
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" class="z-50 max-w-[260px] rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                            {{ epInfo()?.episodeName ?? `Season ${effectiveSeason()}, Episode ${effectiveEpisode()}` }}
                        </TooltipContent>
                    </TooltipRoot>
                </template>
                <span v-else class="shrink-0 font-mono text-xs bg-muted/50 rounded px-1 py-0.5 flex items-center gap-1 text-amber-500 dark:text-amber-400"
                    title="No episode info — configure Match Pattern and Capture Groups.">
                    <TriangleAlert class="w-3 h-3" />
                    S?E?
                </span>
            </template>

            <TooltipRoot :delay-duration="400">
                <TooltipTrigger as-child>
                    <span class="flex-1 truncate font-medium"
                        :class="{ 'text-muted-foreground': !fileState.loading && !fileState.error && !fileState.anyMatched }">
                        {{ fileState.file }}
                    </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" class="z-50 max-w-[400px] rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md break-all">
                    {{ fileState.file }}
                </TooltipContent>
            </TooltipRoot>
            <TooltipRoot :delay-duration="200">
                <TooltipTrigger as-child>
                    <button
                        class="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-0.5"
                        @click.stop="showItemInFolder(sourceDirectory + '/' + fileState.file)">
                        <ExternalLink class="w-3.5 h-3.5" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                    Show in folder
                </TooltipContent>
            </TooltipRoot>
            <span v-if="!fileState.loading && !fileState.error" class="flex items-center gap-1 shrink-0">
                <StreamTypeBadge
                    v-if="fileState.totalStreams > 0 || getChapterCount(fileState) > 0"
                    :counts="{
                        ...computeStreamTypeCounts(fileState.tracks),
                        chapters: {
                            total: getChapterCount(fileState),
                            chapters: getChapterCount(fileState),
                            chaptersEnabled: isFileChaptersEnabled(fileState.file, perFileChapters),
                        },
                    }"
                    variant="matched"
                    :on-click-type="(type: any) => handleTypeBadgeClick(type as string)"
                />
                <span v-else class="text-xs text-muted-foreground italic">No streams</span>
            </span>
            <span v-if="!fileState.loading && !fileState.error"
                class="text-xs text-muted-foreground ml-1 inline-flex items-center">
                <ChevronDown v-if="!expanded" class="w-3 h-3" />
                <ChevronUp v-else class="w-3 h-3" />
            </span>
        </button>

        <!-- Expanded body -->
        <div v-if="expanded && !fileState.loading && !fileState.error" class="border-t">
            <div>
                <!-- Episode info row -->
                    <div v-if="epInfo()">
                        <button data-stream-type="episode"
                            class="w-full flex items-center gap-2 px-3 py-1.5 border-b text-xs text-left hover:bg-muted/30 transition-colors"
                            @click="emit('toggle-section', fileState.file, 'episode-info')">
                            <TooltipRoot>
                                <TooltipTrigger as-child>
                                    <span role="button" tabindex="0"
                                        class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
                                        :class="{ 'text-green-600 dark:text-green-400': true }">
                                        <UiBadgedIcon v-if="hasEpisodeOverride(fileState.file, perFileSeasonOverride, perFileEpisodeOverride)" position="bottom-right">
                                            <Check class="w-3.5 h-3.5" />
                                            <template #subicon>
                                                <Pencil class="w-2 h-2 text-yellow-600 dark:text-yellow-400" />
                                            </template>
                                        </UiBadgedIcon>
                                        <Check v-else class="w-3.5 h-3.5" />
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent side="right" class="z-50 max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                                    {{ hasEpisodeOverride(fileState.file, perFileSeasonOverride, perFileEpisodeOverride) ? 'Episode info overridden. Click to edit.' : 'Click to edit episode info.' }}
                                </TooltipContent>
                            </TooltipRoot>
                            <span class="w-6 shrink-0"></span>
                            <span class="inline-flex items-center justify-center w-5 h-5 rounded shrink-0" :class="STREAM_TYPE_INFO.chapters.color">
                                <Tv class="w-3 h-3" />
                            </span>
                            <span class="font-medium">
                                Season {{ effectiveSeason() }} Episode {{ effectiveEpisode() }}
                                <template v-if="epInfo()?.episodeName"> — {{ epInfo()!.episodeName }}</template>
                            </span>
                            <span class="flex-1"></span>
                            <span class="text-xs text-muted-foreground inline-flex items-center ml-1">
                                <ChevronDown v-if="!isEpisodeInfoExpanded()" class="w-3 h-3" />
                                <ChevronUp v-else class="w-3 h-3" />
                            </span>
                        </button>
                        <!-- Expanded season/episode override controls -->
                        <div v-if="isEpisodeInfoExpanded()" class="border-b bg-muted/30 px-4 py-2">
                            <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                <div class="flex justify-between py-0.5 items-center gap-1">
                                    <span class="text-muted-foreground">Season</span>
                                    <div class="flex rounded-md border border-input bg-background overflow-hidden">
                                        <input type="number"
                                            :value="perFileSeasonOverride?.[fileState.file] ?? epInfo()?.season ?? 1"
                                            min="0"
                                            class="w-12 bg-transparent outline-none px-1.5 py-0.5 text-xs tabular-nums text-right"
                                            @input="onSeasonOverrideInput" />
                                        <button v-if="perFileSeasonOverride?.[fileState.file] != null" type="button" tabindex="-1"
                                            class="flex items-center justify-center px-1 text-muted-foreground hover:text-destructive shrink-0"
                                            @click="emit('update:perFileSeasonOverride', fileState.file, null)">
                                            <X class="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                                <div class="flex justify-between py-0.5 items-center gap-1">
                                    <span class="text-muted-foreground">Episode</span>
                                    <div class="flex rounded-md border border-input bg-background overflow-hidden">
                                        <input type="number"
                                            :value="perFileEpisodeOverride?.[fileState.file] ?? epInfo()?.episode ?? 1"
                                            min="0"
                                            class="w-12 bg-transparent outline-none px-1.5 py-0.5 text-xs tabular-nums text-right"
                                            @input="onEpisodeOverrideInput" />
                                        <button v-if="perFileEpisodeOverride?.[fileState.file] != null" type="button" tabindex="-1"
                                            class="flex items-center justify-center px-1 text-muted-foreground hover:text-destructive shrink-0"
                                            @click="emit('update:perFileEpisodeOverride', fileState.file, null)">
                                            <X class="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Container row -->
                    <button
                        class="w-full flex items-center gap-2 px-3 py-1.5 border-b text-xs text-left hover:bg-muted/30 transition-colors"
                        @click="emit('toggle-section', fileState.file, 'container')">
                        <TooltipRoot>
                            <TooltipTrigger as-child>
                                <span role="button" tabindex="0"
                                    class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
                                    :class="{
                                        'text-green-600 dark:text-green-400': isFileMetadataEnabled(fileState.file, perFileMetadata),
                                        'text-muted-foreground': !isFileMetadataEnabled(fileState.file, perFileMetadata),
                                    }"
                                    @click.stop="emit('update:perFileMetadata', fileState.file, !isFileMetadataEnabled(fileState.file, perFileMetadata))">
                                    <Check v-if="isFileMetadataEnabled(fileState.file, perFileMetadata)" class="w-3.5 h-3.5" />
                                    <Circle v-else class="w-3 h-3" />
                                </span>
                            </TooltipTrigger>
                            <TooltipContent side="right" class="z-50 max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                                {{ isFileMetadataEnabled(fileState.file, perFileMetadata) ? 'Click to disable metadata' : 'Click to enable metadata' }}
                            </TooltipContent>
                        </TooltipRoot>
                        <span class="w-6 shrink-0"></span>
                        <span class="inline-flex items-center justify-center w-5 h-5 rounded shrink-0" :class="STREAM_TYPE_INFO.chapters.color">
                            <Package class="w-3 h-3" />
                        </span>
                        <span class="font-medium">Container</span>
                    <span class="flex-1"></span>
                    <span class="text-xs text-muted-foreground inline-flex items-center ml-1">
                        <ChevronDown v-if="!isContainerExpanded()" class="w-3 h-3" />
                        <ChevronUp v-else class="w-3 h-3" />
                    </span>
                </button>
                <div v-if="isContainerExpanded()" class="border-b bg-muted/30 px-4 py-2">
                    <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <template v-if="Object.keys(getContainerMetadata(fileState)).length > 0">
                            <div v-for="(val, key) in getContainerMetadata(fileState)" :key="key"
                                class="flex justify-between py-0.5">
                                <span class="text-muted-foreground">{{ key }}</span>
                                <span class="font-mono truncate max-w-[60%] text-right" :title="String(val)">{{ val }}</span>
                            </div>
                        </template>
                        <div v-else class="col-span-2 text-muted-foreground py-1">No container metadata available.</div>
                    </div>
                </div>

                <!-- Chapters row -->
                <button data-stream-type="chapters"
                    class="w-full flex items-center gap-2 px-3 py-1.5 border-b text-xs text-left hover:bg-muted/30 transition-colors"
                    @click="emit('toggle-section', fileState.file, 'chapters')">
                    <TooltipRoot>
                        <TooltipTrigger as-child>
                            <span role="button" tabindex="0"
                                class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
                                :class="{
                                    'text-green-600 dark:text-green-400': isFileChaptersEnabled(fileState.file, perFileChapters),
                                    'text-muted-foreground': !isFileChaptersEnabled(fileState.file, perFileChapters),
                                }"
                                @click.stop="emit('update:perFileChapters', fileState.file, !isFileChaptersEnabled(fileState.file, perFileChapters))">
                                <Check v-if="isFileChaptersEnabled(fileState.file, perFileChapters)" class="w-3.5 h-3.5" />
                                <Circle v-else class="w-3 h-3" />
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" class="z-50 max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                            {{ isFileChaptersEnabled(fileState.file, perFileChapters) ? 'Click to disable chapters' : 'Click to enable chapters' }}
                        </TooltipContent>
                    </TooltipRoot>
                    <span class="w-6 shrink-0"></span>
                    <span class="inline-flex items-center justify-center w-5 h-5 rounded shrink-0" :class="STREAM_TYPE_INFO.chapters.color">
                        <BookOpen class="w-3 h-3" />
                    </span>
                    <span class="font-medium">Chapters</span>
                    <span class="flex-1"></span>
                    <span class="text-xs text-muted-foreground">({{ getChapterCount(fileState) }} entries)</span>
                    <span class="text-xs text-muted-foreground inline-flex items-center ml-1">
                        <ChevronDown v-if="!isChaptersExpanded()" class="w-3 h-3" />
                        <ChevronUp v-else class="w-3 h-3" />
                    </span>
                </button>
                <div v-if="isChaptersExpanded()" class="border-b bg-muted/30 px-4 py-2">
                    <!-- Chapter delay override -->
                    <div class="flex items-center gap-2 mb-2 pb-2 border-b border-border/50">
                        <span class="text-xs text-muted-foreground">Delay</span>
                        <div class="flex rounded-md border border-input bg-background overflow-hidden">
                            <input type="number"
                                :value="perFileChapterDelay?.[fileState.file] ?? 0"
                                step="100"
                                class="w-16 bg-transparent outline-none px-1.5 py-0.5 text-xs tabular-nums text-right"
                                @input="onChapterDelayInput" />
                            <button v-if="(perFileChapterDelay?.[fileState.file] ?? 0) !== 0" type="button" tabindex="-1"
                                class="flex items-center justify-center px-1 text-muted-foreground hover:text-destructive shrink-0"
                                @click="emit('update:perFileChapterDelay', fileState.file, 0)">
                                <X class="w-3 h-3" />
                            </button>
                        </div>
                        <span class="text-xs text-muted-foreground">ms</span>
                    </div>
                    <div class="text-xs">
                        <template v-if="getChapterCount(fileState) > 0">
                            <div class="grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-0.5">
                                <div v-for="chapter in parsedChapters" :key="chapter.rawKey" class="contents">
                                    <span class="font-mono text-right whitespace-nowrap"
                                        :class="effectiveChapterDelay !== 0 ? 'text-foreground' : 'text-muted-foreground'"
                                        :title="chapter.originalTimestamp ? `${chapter.originalTimestamp} → ${chapter.timestamp} (${effectiveChapterDelay} ms)` : chapter.timestamp">{{ chapter.originalTimestamp && effectiveChapterDelay !== 0 ? `${chapter.originalTimestamp} → ${chapter.timestamp}` : chapter.timestamp }}</span>
                                    <span v-if="chapter.language" class="font-mono text-muted-foreground uppercase text-[10px]">{{ chapter.language }}</span>
                                    <span v-else class="text-muted-foreground">—</span>
                                    <span class="font-mono truncate">{{ chapter.title }}</span>
                                </div>
                            </div>
                        </template>
                        <div v-else class="text-muted-foreground py-1">No chapter data available.</div>
                    </div>
                </div>

                <!-- Tracks -->
                <div v-if="fileState.tracks.length === 0" class="px-3 py-2 text-xs text-muted-foreground">
                    No streams found for this file.
                </div>
                <StreamTrackRow
                    v-for="track in fileState.tracks"
                    :key="track.index"
                    :track="track"
                    :file="fileState.file"
                    :expanded="isTrackExpanded(track.index)"
                    :excluded-tracks-by-file="excludedTracksByFile"
                    :per-track-modifiers-by-file="perTrackModifiersByFile"
                    @toggle-expand="(f, idx) => emit('toggle-track', f, idx)"
                    @toggle-exclude="(f, idx) => emit('toggle-track-exclude', f, idx)"
                    @update:per-track-modifier="(f, idx, field, val) => emit('update:perTrackModifier', f, idx, field, val)"
                    @clear-per-track-modifier="(f, idx, field) => emit('clearPerTrackModifier', f, idx, field)"
                    @open-raw-dialog="(f, data, idx) => emit('open-raw-dialog', f, data, idx)"
                />
        </div>
    </div>
    </div>
</template>
