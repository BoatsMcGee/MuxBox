<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { Pencil, X } from '@lucide/vue';
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport, ScrollAreaCorner } from 'reka-ui';
import { TooltipRoot, TooltipTrigger, TooltipContent } from 'reka-ui';
import type { TmdbSeriesCache } from '@app/tmdb';
import { useProjectStore } from '@/stores/useProjectStore';
import type { ProjectData } from '@app/preload';
import { getTmdbSeriesDetails, cacheTmdbSeries } from '@app/preload';
import { isGenericSeasonName } from '@/lib/utils';

const props = defineProps<{
    series: TmdbSeriesCache;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'update:series', series: TmdbSeriesCache): void;
}>();

const projectStore = useProjectStore();
const open = defineModel<boolean>('open');

// Track which seasons are expanded
const expandedSeasons = ref<Set<number>>(new Set([1]));

const project = computed(() => projectStore.currentProject);

// ─── Season management ─────────────────────────────────────────

/** Sorted list of season numbers from TMDB data. */
const tmdbSeasonNumbers = computed(() => {
    return Object.keys(props.series.seasons)
        .map(Number)
        .sort((a, b) => a - b);
});

/** All season numbers including user-added ones from episodeNameOverrides. */
const allSeasonNumbers = computed(() => {
    const set = new Set(tmdbSeasonNumbers.value);
    // Also include seasons referenced in overrides
    const overrides = project.value?.episodeNameOverrides;
    if (overrides) {
        for (const key of Object.keys(overrides)) {
            const seasonNum = parseInt(key.split('-')[0], 10);
            if (!isNaN(seasonNum)) set.add(seasonNum);
        }
    }
    return Array.from(set).sort((a, b) => a - b);
});

function toggleSeason(seasonNum: number) {
    if (expandedSeasons.value.has(seasonNum)) {
        expandedSeasons.value.delete(seasonNum);
    } else {
        expandedSeasons.value.add(seasonNum);
        // Re-trigger reactivity
        expandedSeasons.value = new Set(expandedSeasons.value);
    }
}

function addSeason() {
    // Find the highest season number + 1
    const nums = allSeasonNumbers.value;
    const newSeason = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    addSeasonWithNumber(newSeason);
}

/** Add a season with a custom number. */
function addSeasonWithNumber(num: number) {
    if (isNaN(num) || num < 0) return;
    projectStore.updateProject((d: ProjectData) => {
        if (!d.episodeNameOverrides) {
            d.episodeNameOverrides = {};
        }
        const key = `${num}-1`;
        if (!(key in d.episodeNameOverrides!)) {
            d.episodeNameOverrides![key] = '';
        }
    });
    expandedSeasons.value.add(num);
    expandedSeasons.value = new Set(expandedSeasons.value);
}

/** Rename a season — renumbers all its episodes to a new season number. */
function renameSeason(oldSeason: number, newSeason: number) {
    if (isNaN(newSeason) || newSeason < 0 || oldSeason === newSeason) return;
    projectStore.updateProject((d: ProjectData) => {
        if (!d.episodeNameOverrides) return;
        const keysToMove: [string, string][] = [];
        for (const key of Object.keys(d.episodeNameOverrides)) {
            const [s, e] = key.split('-').map(Number);
            if (s === oldSeason && !isNaN(e)) {
                const newKey = `${newSeason}-${e}`;
                keysToMove.push([key, newKey]);
            }
        }
        for (const [oldKey, newKey] of keysToMove) {
            d.episodeNameOverrides[newKey] = d.episodeNameOverrides[oldKey] ?? '';
            delete d.episodeNameOverrides[oldKey];
        }
        if (Object.keys(d.episodeNameOverrides).length === 0) {
            d.episodeNameOverrides = undefined;
        }
    });
}

// ─── Season rename inline editing ─────────────────────
const renamingSeason = ref<number | null>(null);
const renameSeasonValue = ref('');

function startRenameSeason(seasonNum: number) {
    renameSeasonValue.value = String(seasonNum);
    renamingSeason.value = seasonNum;
}

function commitRenameSeason() {
    if (renamingSeason.value !== null) {
        const newSeason = parseInt(renameSeasonValue.value, 10);
        if (!isNaN(newSeason) && newSeason >= 0 && newSeason !== renamingSeason.value) {
            renameSeason(renamingSeason.value, newSeason);
        }
        renamingSeason.value = null;
    }
}

function cancelRenameSeason() {
    renamingSeason.value = null;
}

/** Delete a season and all its episode overrides. */
function deleteSeason(seasonNum: number) {
    projectStore.updateProject((d: ProjectData) => {
        if (!d.episodeNameOverrides) return;
        for (const key of Object.keys(d.episodeNameOverrides)) {
            const s = parseInt(key.split('-')[0], 10);
            if (s === seasonNum) {
                delete d.episodeNameOverrides[key];
            }
        }
        if (Object.keys(d.episodeNameOverrides).length === 0) {
            d.episodeNameOverrides = undefined;
        }
    });
    expandedSeasons.value.delete(seasonNum);
    expandedSeasons.value = new Set(expandedSeasons.value);
}

// ─── Season name management ────────────────────────────────────

/**
 /**
  * Get the display name for a season.
  * Checks project's seasonNames map first (including empty string).
  * Falls back to TMDB season name only if the user has never set a value.
  * Filters out generic TMDB names like "Season 1" since they are redundant.
  */
function getSeasonName(seasonNum: number): string | undefined {
    const p = project.value;
    // Check user-set name in project data (including empty string)
    if (p?.seasonNames && seasonNum in p.seasonNames) {
        return p.seasonNames[seasonNum];
    }
    // Fall back to TMDB, filtering out generic "Season N" names
    const seasonData = props.series.seasons[seasonNum];
    const tmdbName = seasonData?.name;
    return tmdbName && !isGenericSeasonName(tmdbName) ? tmdbName : undefined;
}
/**
 * Set a custom name for a season in the project's seasonNames map.
 * Stores the exact string so the user's text is never replaced by a fallback.
 * An empty string explicitly means "no name" — it is not deleted.
 */
function setSeasonName(seasonNum: number, name: string) {
    projectStore.updateProject((d: ProjectData) => {
        if (!d.seasonNames) {
            d.seasonNames = {};
        }
        d.seasonNames![seasonNum] = name;
    });
}

// ─── Episode management ────────────────────────────────────────

/**
 * Get the title for a given season/episode, checking project overrides first.
 */
function getEpisodeTitle(seasonNum: number, episodeNum: number): string {
    const projectData = project.value;
    const overrideKey = `${seasonNum}-${episodeNum}`;
    const override = projectData?.episodeNameOverrides?.[overrideKey];
    if (override !== undefined) return override;

    const seasonData = props.series.seasons[seasonNum];
    if (!seasonData) return '';
    const episode = seasonData.episodes[episodeNum];
    return episode?.name ?? '';
}

/**
 * Check if an episode exists in TMDB data.
 */
function episodeExists(seasonNum: number, episodeNum: number): boolean {
    const seasonData = props.series.seasons[seasonNum];
    if (!seasonData) return false;
    return episodeNum in seasonData.episodes;
}

/**
 * Set an override title for a given season/episode.
 */
function setEpisodeOverride(seasonNum: number, episodeNum: number, title: string) {
    const key = `${seasonNum}-${episodeNum}`;
    projectStore.updateProject((d: ProjectData) => {
        if (!d.episodeNameOverrides) {
            d.episodeNameOverrides = {};
        }
        if (title.trim()) {
            d.episodeNameOverrides![key] = title.trim();
        } else {
            delete d.episodeNameOverrides![key];
            if (Object.keys(d.episodeNameOverrides!).length === 0) {
                d.episodeNameOverrides = undefined;
            }
        }
    });
}

/**
 * Renumber an episode (change its key from oldSeason-oldEp to newSeason-newEp).
 * Creates an override from the TMDB name if there isn't already one.
 */
function renumberEpisode(oldSeason: number, oldEp: number, newSeason: number, newEp: number) {
    if (oldSeason === newSeason && oldEp === newEp) return;
    const oldKey = `${oldSeason}-${oldEp}`;
    const newKey = `${newSeason}-${newEp}`;
    const currentTitle = getEpisodeTitle(oldSeason, oldEp);
    projectStore.updateProject((d: ProjectData) => {
        if (!d.episodeNameOverrides) {
            d.episodeNameOverrides = {};
        }
        const existingOverride = d.episodeNameOverrides[oldKey];
        const titleToMove = existingOverride !== undefined ? existingOverride : (currentTitle || '');
        delete d.episodeNameOverrides[oldKey];
        d.episodeNameOverrides[newKey] = titleToMove;
    });
}

/**
 * Delete an episode override.
 */
function deleteEpisodeOverride(seasonNum: number, episodeNum: number) {
    const key = `${seasonNum}-${episodeNum}`;
    projectStore.updateProject((d: ProjectData) => {
        if (!d.episodeNameOverrides) return;
        delete d.episodeNameOverrides[key];
        if (Object.keys(d.episodeNameOverrides).length === 0) {
            d.episodeNameOverrides = undefined;
        }
    });
}

/** Delete a single episode (removes its override entry). */
function deleteEpisode(seasonNum: number, epNum: number) {
    const key = `${seasonNum}-${epNum}`;
    projectStore.updateProject((d: ProjectData) => {
        if (!d.episodeNameOverrides) return;
        delete d.episodeNameOverrides[key];
        if (Object.keys(d.episodeNameOverrides).length === 0) {
            d.episodeNameOverrides = undefined;
        }
    });
}

// ─── Episode title inline editing ─────────────────────────────

/** Key of the episode currently being title-edited ("season-episode"), or null. */
const editingEpisodeTitle = ref<string | null>(null);
/** Working value while editing. */
const episodeTitleDraft = ref('');
/** Element currently being edited (function ref, since the input is inside v-for). */
const episodeTitleInputEl = ref<HTMLInputElement | null>(null);

function startEditEpisodeTitle(seasonNum: number, episodeNum: number) {
    editingEpisodeTitle.value = `${seasonNum}-${episodeNum}`;
    episodeTitleDraft.value = getEpisodeTitle(seasonNum, episodeNum);
    nextTick(() => {
        episodeTitleInputEl.value?.focus();
    });
}

function commitEditEpisodeTitle(seasonNum: number, episodeNum: number) {
    if (editingEpisodeTitle.value === null) return;
    setEpisodeOverride(seasonNum, episodeNum, episodeTitleDraft.value);
    editingEpisodeTitle.value = null;
}

function cancelEditEpisodeTitle() {
    editingEpisodeTitle.value = null;
}

/**
 * Get the sorted episode numbers for a given season.
 * Includes both TMDB episodes and user-added override episodes.
 */
function getEpisodeNumbers(seasonNum: number): number[] {
    const set = new Set<number>();
    const seasonData = props.series.seasons[seasonNum];
    if (seasonData) {
        for (const epNum of Object.keys(seasonData.episodes).map(Number)) {
            set.add(epNum);
        }
    }
    // Also include episodes from overrides
    const overrides = project.value?.episodeNameOverrides;
    if (overrides) {
        for (const key of Object.keys(overrides)) {
            const [s, e] = key.split('-').map(Number);
            if (s === seasonNum && !isNaN(e)) set.add(e);
        }
    }
    return Array.from(set).sort((a, b) => a - b);
}

/**
 * Determine the max episode number across all seasons to suggest
 * a reasonable range for episodes that might be missing.
 */
function getMaxEpisodeNumber(seasonNum: number): number {
    const nums = getEpisodeNumbers(seasonNum);
    if (nums.length === 0) return 0;
    return Math.max(...nums);
}

/**
 * Add a new episode entry for a given season and episode number.
 */
function addEpisode(seasonNum: number, epNum: number) {
    if (isNaN(epNum) || epNum < 0) return;
    const key = `${seasonNum}-${epNum}`;
    projectStore.updateProject((d: ProjectData) => {
        if (!d.episodeNameOverrides) {
            d.episodeNameOverrides = {};
        }
        if (!(key in d.episodeNameOverrides!)) {
            d.episodeNameOverrides![key] = '';
        }
    });
}
/**
 * Determine if a title is user-overridden (not from TMDB).
 */
function isOverridden(seasonNum: number, episodeNum: number): boolean {
    const key = `${seasonNum}-${episodeNum}`;
    return project.value?.episodeNameOverrides?.[key] !== undefined;
}

/**
 * Handle pressing Enter in the "Add episode" input field.
 */
function handleAddEpisodeKeydown(e: KeyboardEvent, seasonNum: number) {
    const input = e.target as HTMLInputElement;
    const epNum = parseInt(input.value);
    if (!isNaN(epNum) && epNum >= 0) {
        addEpisode(seasonNum, epNum);
        input.value = '';
    }
}

/**
 * Handle clicking the "Add" button for episodes.
 */
function handleAddEpisodeClick(e: Event, seasonNum: number) {
    const btn = e.currentTarget as HTMLElement;
    const container = btn.parentElement;
    if (!container) return;
    const input = container.querySelector('input[type="number"]') as HTMLInputElement | null;
    if (!input) return;
    const epNum = parseInt(input.value);
    if (!isNaN(epNum) && epNum >= 0) {
        addEpisode(seasonNum, epNum);
        input.value = '';
    }
}

// ─── TMDB refresh ──────────────────────────────────────────────
const refreshing = ref(false);

async function refreshTmdb() {
    const projectData = project.value;
    if (!projectData?.tmdbSeriesId) return;
    refreshing.value = true;
    try {
        const fresh = await getTmdbSeriesDetails(projectData.tmdbSeriesId);
        await cacheTmdbSeries(projectData.tmdbSeriesId, fresh);
        emit('update:series', fresh);
    } catch (err) {
        console.error('Failed to refresh TMDB data:', err);
    } finally {
        refreshing.value = false;
    }
}
</script>

<template>
    <Teleport to="body">
        <div
            v-if="open"
            class="fixed inset-0 z-50 flex items-center justify-center"
        >
            <div
                class="fixed inset-0 bg-black/80"
                @click="emit('close')"
            />
            <div
                class="relative z-50 w-full max-w-3xl max-h-[85vh] overflow-hidden border bg-background p-6 shadow-lg sm:rounded-lg flex flex-col"
            >
                <!-- Header -->
                <div class="flex items-center justify-between mb-4 shrink-0">
                    <h2 class="text-lg font-semibold truncate pr-4">
                        Browse Seasons — {{ series.name }}
                    </h2>
                    <div class="flex items-center gap-2 shrink-0">
                        <!-- Refresh TMDB (only when TMDB data is available) -->
                        <TooltipRoot v-if="series.id > 0" :delay-duration="200">
                            <TooltipTrigger as-child>
                                <button
                                    class="inline-flex items-center justify-center rounded-md text-sm font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 h-8 px-3"
                                    :disabled="refreshing"
                                    @click="refreshTmdb"
                                >
                                    {{ refreshing ? 'Refreshing...' : '⟳ Refresh' }}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                Refresh TMDB data and cache
                            </TooltipContent>
                        </TooltipRoot>
                        <!-- Add season with custom number -->
                        <div class="flex items-center gap-1">
                            <input
                                type="number"
                                min="0"
                                :placeholder="`Season # (${(allSeasonNumbers.length > 0 ? Math.max(...allSeasonNumbers) + 1 : 1)})`"
                                class="flex h-8 w-20 rounded-md border border-input bg-background px-2 text-xs font-mono"
                                @keydown.enter="(e: KeyboardEvent) => {
                                    const val = parseInt((e.target as HTMLInputElement).value);
                                    if (!isNaN(val) && val >= 0) {
                                        addSeasonWithNumber(val);
                                        (e.target as HTMLInputElement).value = '';
                                    }
                                }"
                            />
                            <TooltipRoot :delay-duration="200">
                                <TooltipTrigger as-child>
                                    <button
                                        class="inline-flex items-center justify-center rounded-md text-sm font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 h-8 px-3"
                                        @click="addSeason"
                                    >
                                        + Season
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                    Add next season
                                </TooltipContent>
                            </TooltipRoot>
                        </div>
                        <button
                            class="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100"
                            @click="emit('close')"
                        >
                            <span class="text-xl leading-none">&times;</span>
                            <span class="sr-only">Close</span>
                        </button>
                    </div>
                </div>

                <!-- Season list (scrollable) -->
                <ScrollAreaRoot class="flex-1 min-h-0 flex flex-col overflow-hidden" type="always">
                    <ScrollAreaViewport class="flex-1 min-h-0">
                        <div class="-mx-6 px-6">
                        <div v-if="allSeasonNumbers.length === 0" class="text-center text-muted-foreground py-8">
                            No season data available.
                        </div>

                        <div
                            v-for="seasonNum in allSeasonNumbers"
                            :key="seasonNum"
                            class="border rounded-lg mb-3 overflow-hidden"
                        >
                            <!-- Season header -->
                        <div
                            class="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-accent/50 transition-colors text-left"
                        >
                            <button
                                class="flex items-center gap-2 flex-1 min-w-0 text-left"
                                @click="toggleSeason(seasonNum)"
                            >
                                <span
                                    class="text-muted-foreground transition-transform duration-200 shrink-0"
                                    :class="{ 'rotate-180': expandedSeasons.has(seasonNum) }"
                                >
                                    ▼
                                </span>
                                <!-- Editable season number (inline rename) -->
                                <template v-if="renamingSeason === seasonNum">
                                    <input
                                        type="number"
                                        min="0"
                                        class="w-16 h-7 px-1 text-sm border rounded bg-background text-center font-mono"
                                        :value="renameSeasonValue"
                                        @input="renameSeasonValue = ($event.target as HTMLInputElement).value"
                                        @keyup.enter="commitRenameSeason"
                                        @keyup.escape="cancelRenameSeason"
                                        @blur="commitRenameSeason"
                                        ref="renameInput"
                                    />
                                </template>
                                <template v-else>
                                    <span @click.stop="startRenameSeason(seasonNum)" class="cursor-pointer hover:bg-accent rounded px-0.5 -ml-0.5">
                                        Season {{ seasonNum }}
                                    </span>
                                </template>
                                <!-- Editable season name -->
                                <input
                                    class="ml-1 h-7 w-40 rounded border border-input bg-background px-1.5 py-0.5 text-xs font-mono"
                                    :value="getSeasonName(seasonNum) ?? ''"
                                    :placeholder="seasonNum === 0 ? 'Specials' : `Season ${seasonNum} Name`"
                                    maxlength="80"
                                    @input="setSeasonName(seasonNum, ($event.target as HTMLInputElement).value)"
                                />
                                <span v-if="!episodeExists(seasonNum, 1)" class="text-yellow-600 dark:text-yellow-400 ml-2 text-xs">
                                    (user-added)
                                </span>
                                <span class="text-muted-foreground font-normal ml-2">
                                    {{ getEpisodeNumbers(seasonNum).length }} episodes
                                </span>
                            </button>
                            <TooltipRoot v-if="!tmdbSeasonNumbers.includes(seasonNum)" :delay-duration="200">
                                <TooltipTrigger as-child>
                                    <button
                                        class="shrink-0 ml-2 px-2 py-0.5 text-xs rounded border hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
                                        @click="deleteSeason(seasonNum)"
                                    >
                                        Delete
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                    Delete this season
                                </TooltipContent>
                            </TooltipRoot>
                        </div>

                        <!-- Episode list (expandable) -->
                        <div v-if="expandedSeasons.has(seasonNum)" class="border-t">
                            <div
                                v-for="epNum in getEpisodeNumbers(seasonNum)"
                                :key="`${seasonNum}-${epNum}`"
                                class="flex items-center gap-2 px-4 py-2 text-sm border-b last:border-b-0 hover:bg-accent/30"
                                :class="{ 'bg-yellow-50 dark:bg-yellow-950/20': !episodeExists(seasonNum, epNum) }"
                            >
                                <!-- Episode number (editable) -->
                                <div class="flex items-center gap-1 shrink-0">
                                    <span class="text-xs text-muted-foreground">E</span>
                                    <input
                                        type="number"
                                        min="0"
                                        class="w-12 h-7 px-1 text-sm border rounded bg-background text-center font-mono"
                                        :value="epNum"
                                        @change="renumberEpisode(seasonNum, epNum, seasonNum, Number(($event.target as HTMLInputElement).value) || 0)"
                                    />
                                </div>

                                <!-- Title display / override input -->
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center gap-2">
                                        <input
                                            v-if="!episodeExists(seasonNum, epNum) || isOverridden(seasonNum, epNum)"
                                            class="flex h-7 w-full rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
                                            :value="getEpisodeTitle(seasonNum, epNum)"
                                            :placeholder="episodeExists(seasonNum, epNum) ? 'Override title...' : 'Enter title...'"
                                            @input="setEpisodeOverride(seasonNum, epNum, ($event.target as HTMLInputElement).value)"
                                        />
                                        <template v-else-if="editingEpisodeTitle === `${seasonNum}-${epNum}`">
                                            <input
                                                :ref="(el: unknown) => { episodeTitleInputEl = el as HTMLInputElement | null; }"
                                                class="flex h-7 w-full rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
                                                :value="episodeTitleDraft"
                                                placeholder="Override title..."
                                                @input="episodeTitleDraft = ($event.target as HTMLInputElement).value"
                                                @keyup.enter="commitEditEpisodeTitle(seasonNum, epNum)"
                                                @keyup.escape="cancelEditEpisodeTitle"
                                                @blur="commitEditEpisodeTitle(seasonNum, epNum)"
                                            />
                                        </template>
                                        <template v-else>
                                            <TooltipRoot :delay-duration="200">
                                                <TooltipTrigger as-child>
                                                    <span class="truncate block text-sm cursor-help">
                                                        {{ getEpisodeTitle(seasonNum, epNum) || '—' }}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                                    {{ getEpisodeTitle(seasonNum, epNum) }}
                                                </TooltipContent>
                                            </TooltipRoot>
                                            <TooltipRoot :delay-duration="200">
                                                <TooltipTrigger as-child>
                                                    <button
                                                        class="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                                        @click.stop="startEditEpisodeTitle(seasonNum, epNum)"
                                                    >
                                                        <Pencil class="w-3 h-3" />
                                                    </button>
                                                </TooltipTrigger>
                                                <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                                    Edit title
                                                </TooltipContent>
                                            </TooltipRoot>
                                        </template>
                                    </div>
                                </div>

                                <!-- Missing TMDB indicator -->
                                <TooltipRoot v-if="!episodeExists(seasonNum, epNum)" :delay-duration="200">
                                    <TooltipTrigger as-child>
                                        <span
                                            class="text-xs text-yellow-600 dark:text-yellow-400 shrink-0 cursor-help"
                                        >
                                            ⚠
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                        Not in TMDB
                                    </TooltipContent>
                                </TooltipRoot>

                                <!-- Override clear button (only for TMDB episodes — user-added episodes are removed via Delete) -->
                                <TooltipRoot v-if="episodeExists(seasonNum, epNum) && isOverridden(seasonNum, epNum)" :delay-duration="200">
                                    <TooltipTrigger as-child>
                                        <button
                                            class="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                            @click="deleteEpisodeOverride(seasonNum, epNum)"
                                        >
                                            <X class="w-3 h-3" />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                        Clear override
                                    </TooltipContent>
                                </TooltipRoot>

                                <!-- Delete episode button -->
                                <TooltipRoot v-if="!episodeExists(seasonNum, epNum)" :delay-duration="200">
                                    <TooltipTrigger as-child>
                                        <button
                                            class="shrink-0 px-1.5 py-0.5 text-xs rounded border text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                            @click="deleteEpisode(seasonNum, epNum)"
                                        >
                                            ✕
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                        Delete this episode
                                    </TooltipContent>
                                </TooltipRoot>

                                <!-- Air date -->
                                <span v-if="series.seasons[seasonNum]?.episodes[epNum]?.airDate"
                                    class="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                                    {{ series.seasons[seasonNum]!.episodes[epNum]!.airDate }}
                                </span>
                            </div>

                            <!-- Add new episode button -->
                            <div class="px-4 py-2 border-t border-dashed flex items-center gap-2">
                                <span class="text-xs text-muted-foreground">Add episode:</span>
                                <span class="text-xs text-muted-foreground">E</span>
                                <input
                                    type="number"
                                    min="0"
                                    :placeholder="`# (next: ${getMaxEpisodeNumber(seasonNum) + 1})`"
                                    class="flex h-7 w-20 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
                                    @keydown.enter="handleAddEpisodeKeydown($event, seasonNum)"
                                />
                                <button
                                    class="px-2 py-1 text-xs border rounded-md hover:bg-accent"
                                    @click="handleAddEpisodeClick($event, seasonNum)"
                                >
                                    Add
                                </button>
                            </div>
                        </div>
                    </div>
                    </div>
                    </ScrollAreaViewport>
                    <ScrollAreaScrollbar orientation="vertical" class="group w-2.5 bg-muted/20">
                        <ScrollAreaThumb class="bg-muted-foreground/50 group-hover:bg-muted-foreground/80 rounded-full transition-colors" />
                    </ScrollAreaScrollbar>
                    <ScrollAreaCorner />
                </ScrollAreaRoot>

                <!-- Footer -->
                <div class="flex justify-between items-center mt-4 pt-3 border-t shrink-0">
                    <button
                        class="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2"
                        @click="emit('close')"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>
