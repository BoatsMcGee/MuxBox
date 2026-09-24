<script setup lang="ts">
import { onMounted, onUnmounted, watch, ref, computed, nextTick } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { useProjectStore } from '@/stores/useProjectStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { loadProject, saveProject, listFiles, openDirectoryDialog, getCachedTmdbSeries, removeProject, showItemInFolder, clearProbeCache } from '@app/preload';
import type { ProjectData, MuxerSource } from '@app/preload';
import type { TmdbSeriesCache } from '@app/tmdb';
import { tryParseRegex } from '@/lib/utils';
import SeriesSearch from '@/components/series/SeriesSearch.vue';
import TmdbSeasonBrowser from '@/components/series/TmdbSeasonBrowser.vue';
import EpisodeQueue from '@/components/episode/EpisodeQueue.vue';
import RenameTemplateModal from '@/components/rename/RenameTemplateModal.vue';
import { useEpisodeQueueStore } from '@/stores/useEpisodeQueueStore';
import { DnDProvider } from '@vue-dnd-kit/core';
import { TooltipRoot, TooltipTrigger, TooltipContent } from 'reka-ui';
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport, ScrollAreaCorner } from 'reka-ui';
import { DialogRoot, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui';
import { Settings, Plus, X, Copy, Trash2, ExternalLink, Check } from '@lucide/vue';

const route = useRoute();
const router = useRouter();
const projectStore = useProjectStore();
const projectsStore = useProjectsStore();
const queueStore = useEpisodeQueueStore();
const projectId = ref(route.params.id as string);
const showRenameModal = ref(false);
const showDeleteDialog = ref(false);
const projectDeleted = ref(false);
const saveTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const filesBySource = ref<Record<string, string[]>>({});
const selectedSeries = ref<TmdbSeriesCache | null>(null);
const queueDataLoaded = ref(false);
const showSeasonBrowser = ref(false);
const editingName = ref(false);
const editingNameInput = ref('');

const episodeQueueRef = ref<InstanceType<typeof EpisodeQueue> | null>(null);

const project = computed(() => projectStore.currentProject);

/** Series object for the season browser — uses TMDB data if available, otherwise a synthetic empty series. */
const browserSeries = computed<TmdbSeriesCache>(() => {
    if (selectedSeries.value) return selectedSeries.value;
    return {
        id: 0,
        name: project.value?.seriesName ?? 'Unknown Series',
        seasons: {},
    };
});

function startEditingName() {
    if (queueStore.hasActiveProcessing) return;
    editingNameInput.value = project.value?.name ?? '';
    editingName.value = true;
    nextTick(() => {
        const el = document.getElementById('project-name-input');
        if (!(el instanceof HTMLInputElement)) return;
        el.focus();
        el.select();
    });
}

function commitName() {
    if (!editingName.value) return;
    editingName.value = false;
    const name = editingNameInput.value.trim();
    if (name && project.value) {
        projectStore.updateProject((d: ProjectData) => { d.name = name; });
    }
}

function cancelEditingName() {
    editingName.value = false;
}

interface TagEditRow {
    key: string;
    value: string;
}

/** Whether we're editing tags inline. */
const showTagsEditor = ref(false);

/** Working copy of tags while editing. */
const tagsEditCopy = ref<TagEditRow[]>([]);

function startEditingTags() {
    const tags = projectStore.currentProject?.muxOptions.modifyTags ?? {};
    tagsEditCopy.value = Object.entries(tags).map(([k, v]) => ({ key: k, value: v ?? '' }));
    showTagsEditor.value = true;
}

function cancelEditingTags() {
    showTagsEditor.value = false;
}

function commitTags() {
    const hasTags = tagsEditCopy.value.length > 0;
    projectStore.updateProject((d: ProjectData) => {
        if (hasTags) {
            const tags: Record<string, string> = {};
            for (const row of tagsEditCopy.value) {
                if (row.key) tags[row.key] = row.value;
            }
            d.muxOptions = { ...d.muxOptions, modifyTags: tags };
        } else {
            const { modifyTags: _remove, ...rest } = d.muxOptions;
            d.muxOptions = rest;
        }
    });
    if (hasTags) {
        // Tags are applied at mux time via episode.modifyTags — no live push needed
    }
    showTagsEditor.value = false;
}

function addTagEditRow() {
    tagsEditCopy.value = [...tagsEditCopy.value, { key: '', value: '' }];
}

function updateEditKey(idx: number, newKey: string) {
    const copy = [...tagsEditCopy.value];
    copy[idx] = { ...copy[idx], key: newKey };
    tagsEditCopy.value = copy;
}

function updateEditValue(idx: number, newValue: string) {
    const copy = [...tagsEditCopy.value];
    copy[idx] = { ...copy[idx], value: newValue };
    tagsEditCopy.value = copy;
}

function removeEditRow(idx: number) {
    const copy = [...tagsEditCopy.value];
    copy.splice(idx, 1);
    tagsEditCopy.value = copy;
}

async function loadProjectData() {
    // If the store already holds this project's data (e.g. navigating back from
    // SourceEditView), reuse it instead of re-reading from disk.
    const cached = projectStore.currentProject;
    if (cached && cached.id === projectId.value) {
        projectsStore.setCurrentProject(projectId.value);
        // Still need to refresh file listings in case the source changed
        for (const source of cached.sources) {
            if (source.directory) {
                try {
                    filesBySource.value[source.directory] = listFiles(source.directory);
                } catch {
                    filesBySource.value[source.directory] = [];
                }
            }
        }
        // Reload TMDB cache for the saved series ID
        if (cached.tmdbSeriesId) {
            await loadTmdbCache(cached.tmdbSeriesId);
        }
        queueDataLoaded.value = true;
        return;
    }

    try {
        const loaded = await loadProject(projectId.value);
        if (!loaded) {
            router.push({ name: 'landing' });
            return;
        }
        if (loaded.travels) {
            projectStore.loadFromSerialized(loaded.data, loaded.travels as Parameters<typeof projectStore.loadFromSerialized>[1]);
        } else {
            projectStore.initProject(loaded.data);
        }
        projectsStore.setCurrentProject(projectId.value);

        for (const source of loaded.data.sources) {
            if (source.directory) {
                try {
                    filesBySource.value[source.directory] = listFiles(source.directory);
                } catch {
                    filesBySource.value[source.directory] = [];
                }
            }
        }

        // Load cached TMDB data for the saved series ID so SeriesSearch shows
        // the season count and Browse Seasons button immediately.
        if (loaded.data.tmdbSeriesId) {
            await loadTmdbCache(loaded.data.tmdbSeriesId);
        }
        queueDataLoaded.value = true;
    } catch {
        router.push({ name: 'landing' });
    }
}

async function loadTmdbCache(seriesId: number) {
    try {
        const cached = await getCachedTmdbSeries(seriesId);
        if (cached) {
            selectedSeries.value = cached;
        }
    } catch {
        // Non-critical — user can re-select via search
    }
}

function countMatchedFiles(source: MuxerSource): number {
    const allFiles = filesBySource.value[source.directory];
    if (!allFiles) return 0;
    if (!source.match?.regex) return allFiles.length;
    const regex = tryParseRegex(source.match.regex, source.match.regexFlags);
    if (!regex) return allFiles.length;
    return allFiles.filter((f) => regex.test(f)).length;
}

function toIPCSerializable<T>(value: T): T {
    return JSON.parse(
        JSON.stringify(value, (_key, val) => {
            if (val instanceof RegExp) {
                return val.toString();
            }
            return val;
        }),
    ) as T;
}

async function saveProjectData() {
    const data = projectStore.currentProject;
    if (!data) return;
    const travels = projectStore.serialize();
    const payload = toIPCSerializable({ data, travels });
    await saveProject(payload as { data: ProjectData; travels: unknown });
    projectsStore.updateFromData(data);
}

function scheduleSave() {
    if (saveTimeout.value) clearTimeout(saveTimeout.value);
    saveTimeout.value = setTimeout(saveProjectData, 500);
}

function handleKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        projectStore.undo();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        projectStore.redo();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        projectStore.redo();
    }
}

function handleSeriesSelect(series: TmdbSeriesCache) {
    selectedSeries.value = series;
    projectStore.updateProject((d: ProjectData) => {
        d.tmdbSeriesId = series.id;
        d.tmdbSeriesName = series.name;
    });
}

function handleSeriesClear() {
    if (queueStore.hasActiveProcessing) return;
    selectedSeries.value = null;
    projectStore.updateProject((d: ProjectData) => {
        delete (d as Partial<ProjectData>).tmdbSeriesId;
        delete (d as Partial<ProjectData>).tmdbSeriesName;
    });
}

async function deleteProject() {
    if (saveTimeout.value) clearTimeout(saveTimeout.value);
    saveTimeout.value = null;
    projectDeleted.value = true;
    await removeProject(projectId.value);
    projectsStore.removeProject(projectId.value);
    router.push({ name: 'landing', query: { deleted: '1' } });
}

function navigateToAddSource() {
    router.push({ name: 'source-new', params: { id: projectId.value } });
}

function navigateToEditSource(idx: number) {
    router.push({ name: 'source-edit', params: { id: projectId.value, sourceIdx: String(idx) } });
}

function removeSource(idx: number) {
    projectStore.updateProject((d: ProjectData) => {
        const source = d.sources[idx];
        if (source?.directory) {
            delete filesBySource.value[source.directory];
        }
        d.sources.splice(idx, 1);
    });
}

watch(
    () => projectStore.currentProject,
    () => scheduleSave(),
);

onMounted(() => {
    loadProjectData();
    window.addEventListener('keydown', handleKeyDown);
});

onBeforeRouteLeave((_to, _from) => {
    if (queueStore.hasActiveProcessing) {
        const answer = window.confirm('Muxing is in progress. Leaving now will cancel all active muxing. Continue?');
        if (!answer) {
            return false;
        }
        queueStore.stopAllProcessing();
    }
    return true;
});

onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown);
    if (saveTimeout.value) clearTimeout(saveTimeout.value);
    if (!projectDeleted.value) {
        saveProjectData();
    }
    // Clear probe cache to release any cached StreamInfo data
    clearProbeCache().catch(() => {});
});
</script>

<template>
    <DnDProvider>
    <div class="flex flex-col min-h-screen">
        <header class="border-b px-4 py-2 flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 flex-1 min-w-0">
                <TooltipRoot v-if="queueStore.hasActiveProcessing" :delay-duration="200">
                    <TooltipTrigger as-child>
                        <button
                            class="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:pointer-events-none shrink-0"
                            :disabled="queueStore.hasActiveProcessing" @click="router.push({ name: 'landing' })">
                            ← Back
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"
                        class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                        {{ queueStore.lockReason }}
                    </TooltipContent>
                </TooltipRoot>
                <button v-else class="text-sm text-muted-foreground hover:text-foreground shrink-0"
                    @click="router.push({ name: 'landing' })">
                    ← Back
                </button>

                <!-- Project Name (inline editable) -->
                <div v-if="!editingName" class="shrink-0">
                    <h1 class="text-base font-semibold cursor-pointer hover:bg-accent rounded-md px-1 -ml-1"
                        :class="{ 'opacity-50 pointer-events-none': queueStore.hasActiveProcessing }"
                        @click="startEditingName">
                        {{ project?.name || 'Loading...' }}
                    </h1>
                </div>
                <div v-else class="flex items-center shrink-0">
                    <input id="project-name-input"
                        class="text-base font-semibold px-1 py-0.5 border rounded-md bg-background w-64"
                        :value="editingNameInput" @input="editingNameInput = ($event.target as HTMLInputElement).value"
                        @keydown.enter="commitName" @keydown.escape="cancelEditingName" @blur="commitName" />
                </div>

                <!-- Output Directory -->
                <div class="flex items-center gap-2 flex-1 min-w-0">
                    <TooltipRoot v-if="queueStore.hasActiveProcessing" :delay-duration="200">
                        <TooltipTrigger as-child>
                            <input
                                class="flex-1 px-2 py-1 border rounded-md bg-background text-xs font-mono min-w-0 disabled:opacity-50 disabled:pointer-events-none"
                                :value="project?.outputDirectory || ''"
                                placeholder="Output directory (leave empty to write next to source)" readonly
                                disabled />
                        </TooltipTrigger>
                        <TooltipContent side="bottom"
                            class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                            {{ queueStore.lockReason }}
                        </TooltipContent>
                    </TooltipRoot>
                    <input v-else class="flex-1 px-2 py-1 border rounded-md bg-background text-xs font-mono min-w-0"
                        :value="project?.outputDirectory || ''"
                        placeholder="Output directory (leave empty to write next to source)" readonly />
                    <TooltipRoot :delay-duration="200">
                        <TooltipTrigger as-child>
                            <button
                                class="px-3 py-1 border rounded-md hover:bg-accent text-xs shrink-0 disabled:opacity-50 disabled:pointer-events-none"
                                :disabled="queueStore.hasActiveProcessing" @click="async () => {
                                    const dir = await openDirectoryDialog(project?.outputDirectory || undefined);
                                    if (dir) {
                                        projectStore.updateProject((d: ProjectData) => { d.outputDirectory = dir; });
                                    }
                                }">
                                Browse
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom"
                            class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                            <template v-if="queueStore.hasActiveProcessing">{{ queueStore.lockReason }}</template>
                            <template v-else>Browse for output directory</template>
                        </TooltipContent>
                    </TooltipRoot>
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <TooltipRoot v-if="queueStore.hasActiveProcessing" :delay-duration="200">
                    <TooltipTrigger as-child>
                        <button class="px-3 py-1 text-xs border rounded-md hover:bg-accent disabled:opacity-50"
                            :disabled="true" @click="projectStore.undo">
                            Undo
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"
                        class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                        {{ queueStore.lockReason }}
                    </TooltipContent>
                </TooltipRoot>
                <button v-else class="px-3 py-1 text-xs border rounded-md hover:bg-accent disabled:opacity-50"
                    :disabled="!projectStore.canUndo" @click="projectStore.undo">
                    Undo
                </button>
                <TooltipRoot v-if="queueStore.hasActiveProcessing" :delay-duration="200">
                    <TooltipTrigger as-child>
                        <button class="px-3 py-1 text-xs border rounded-md hover:bg-accent disabled:opacity-50"
                            :disabled="true" @click="projectStore.redo">
                            Redo
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"
                        class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                        {{ queueStore.lockReason }}
                    </TooltipContent>
                </TooltipRoot>
                <button v-else class="px-3 py-1 text-xs border rounded-md hover:bg-accent disabled:opacity-50"
                    :disabled="!projectStore.canRedo" @click="projectStore.redo">
                    Redo
                </button>
                <TooltipRoot v-if="queueStore.hasActiveProcessing" :delay-duration="200">
                    <TooltipTrigger as-child>
                        <button
                            class="p-1.5 rounded-md hover:bg-accent disabled:opacity-50 disabled:pointer-events-none"
                            :disabled="queueStore.hasActiveProcessing" @click="router.push({ name: 'settings' })">
                            <Settings class="h-4 w-4" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"
                        class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                        {{ queueStore.lockReason }}
                    </TooltipContent>
                </TooltipRoot>
                <button v-else class="p-1.5 rounded-md hover:bg-accent" @click="router.push({ name: 'settings' })">
                    <Settings class="h-4 w-4" />
                </button>
            </div>
        </header>

        <main class="flex-1 p-6">
            <div v-if="!project" class="flex items-center justify-center h-full">
                <p class="text-muted-foreground">Loading project...</p>
            </div>

            <div v-else class="max-w-7xl mx-auto">
                <div class="grid grid-cols-1 xl:grid-cols-2 xl:grid-rows-[1fr] gap-6 xl:min-h-0" :class="{ 'xl:h-[calc(100vh-5rem)]': project }">
                    <!-- Left Column: Project Settings + Sources -->
                    <ScrollAreaRoot class="xl:overflow-hidden xl:flex xl:flex-col" type="auto" :style="{ height: '100%' }">
                        <ScrollAreaViewport class="xl:flex-1 xl:min-h-0">
                            <div class="space-y-6">
                <!-- Project Settings -->
                <section class="rounded-lg border bg-card p-6 space-y-4">
                    <div class="flex items-center justify-between">
                        <h2 class="text-lg font-semibold">Project Settings</h2>
                        <TooltipRoot v-if="queueStore.hasActiveProcessing" :delay-duration="200">
                            <TooltipTrigger as-child>
                                <button
                                    class="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                                    disabled>
                                    <Trash2 class="h-4 w-4" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom"
                                class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                {{ queueStore.lockReason }}
                            </TooltipContent>
                        </TooltipRoot>
                        <TooltipRoot v-else :delay-duration="200">
                            <TooltipTrigger as-child>
                                <button
                                    class="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                    @click="showDeleteDialog = true">
                                    <Trash2 class="h-4 w-4" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom"
                                class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                Delete Project
                            </TooltipContent>
                        </TooltipRoot>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <div class="flex items-center gap-2 mb-1">
                                <label class="text-sm font-medium">Series Name</label>
                                <div v-if="selectedSeries" class="flex items-center gap-1.5 text-sm">
                                    <Check class="h-4 w-4 text-green-600 shrink-0" />
                                    <span class="text-foreground truncate max-w-[200px]">{{ selectedSeries.name }}</span>
                                    <span v-if="selectedSeries" class="text-xs text-muted-foreground shrink-0">
                                        · {{ Object.keys(selectedSeries.seasons).length }} {{ Object.keys(selectedSeries.seasons).length === 1 ? 'Season' : 'Seasons' }}
                                    </span>
                                    <button class="p-0.5 text-muted-foreground hover:text-destructive shrink-0" @click="handleSeriesClear">
                                        <X class="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                            <div class="flex gap-2">
                                <div class="flex-1">
                                    <TooltipRoot v-if="queueStore.hasActiveProcessing" :delay-duration="200">
                                        <TooltipTrigger as-child>
                                            <div class="opacity-50 pointer-events-none">
                                                <SeriesSearch :model-value="project.seriesName"
                                                    :initial-series-id="project.tmdbSeriesId"
                                                    @update:model-value="projectStore.updateProject((d: ProjectData) => { d.seriesName = $event; })"
                                                    @select="handleSeriesSelect" @clear="handleSeriesClear" />
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom"
                                            class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                            {{ queueStore.lockReason }}
                                        </TooltipContent>
                                    </TooltipRoot>
                                    <SeriesSearch v-else :model-value="project.seriesName"
                                        :initial-series-id="project.tmdbSeriesId"
                                        @update:model-value="projectStore.updateProject((d: ProjectData) => { d.seriesName = $event; })"
                                        @select="handleSeriesSelect" @clear="handleSeriesClear" />
                                </div>
                                <TooltipRoot :delay-duration="200">
                                    <TooltipTrigger as-child>
                                        <button
                                            class="h-9 px-4 text-xs border rounded-md hover:bg-accent shrink-0 disabled:opacity-50 disabled:pointer-events-none"
                                            :disabled="queueStore.hasActiveProcessing"
                                            @click="showSeasonBrowser = true">
                                            Seasons
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom"
                                        class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                        <template v-if="queueStore.hasActiveProcessing">{{ queueStore.lockReason
                                        }}</template>
                                        <template v-else>Browse seasons and episodes</template>
                                    </TooltipContent>
                                </TooltipRoot>
                            </div>
                        </div>
                    </div>
                    <div>
                        <div class="mb-1">
                            <label class="text-sm font-medium">Rename Template</label>
                        </div>
                        <div class="rounded-md border border-input bg-background px-3 py-2 text-sm focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
                            :class="{ 'opacity-50 pointer-events-none': queueStore.hasActiveProcessing }">
                            <RenameTemplateModal :open="showRenameModal" :template="project?.rename.template ?? ''"
                                :field-config="project?.rename.fieldConfig" :series-name="project?.seriesName"
                                @open="showRenameModal = true" @close="showRenameModal = false" @save="(template: string, fieldConfig: Record<string, { prefix: string; suffix: string; alwaysAdd: boolean; padding?: number }>) => {
                                    projectStore.updateProject((d: ProjectData) => {
                                        d.rename.template = template;
                                        d.rename.fieldConfig = fieldConfig;
                                    });
                                    showRenameModal = false;
                                }" />
                        </div>
                    </div>

                    <!-- Tags -->
                    <div class="space-y-2">
                        <div class="mb-1">
                            <label class="text-sm font-medium">Tags</label>
                        </div>
                        <div class="rounded-md border border-input bg-background px-3 py-2 text-sm focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
                            :class="{ 'opacity-50 pointer-events-none': queueStore.hasActiveProcessing }">
                            <template v-if="!showTagsEditor">
                                <div class="flex items-center gap-2">
                                    <div v-if="project.muxOptions.modifyTags && Object.keys(project.muxOptions.modifyTags).length > 0"
                                        class="flex-1 min-w-0 flex flex-wrap gap-1.5">
                                        <span v-for="(value, key) in project.muxOptions.modifyTags" :key="key"
                                            class="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-0.5 text-xs font-mono">
                                            <span class="text-muted-foreground">{{ key }}</span>
                                            <span class="text-foreground">={{ value }}</span>
                                        </span>
                                    </div>
                                    <div v-else class="flex-1 min-w-0 text-xs text-muted-foreground">
                                        No tags configured
                                    </div>
                                    <TooltipRoot v-if="queueStore.hasActiveProcessing" :delay-duration="200">
                                        <TooltipTrigger as-child>
                                            <button type="button"
                                                class="h-9 px-4 text-xs border rounded-md shrink-0 disabled:opacity-50"
                                                disabled>
                                                Edit Tags
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom"
                                            class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                            {{ queueStore.lockReason }}
                                        </TooltipContent>
                                    </TooltipRoot>
                                    <button v-else type="button"
                                        class="h-9 px-4 text-xs border rounded-md hover:bg-accent shrink-0"
                                        @click="startEditingTags">
                                        Edit Tags
                                    </button>
                                </div>
                            </template>
                            <template v-else>
                                <div class="space-y-3">
                                    <div v-if="tagsEditCopy.length === 0" class="text-xs text-muted-foreground">
                                        No tags yet.
                                    </div>
                                    <div v-for="(row, idx) in tagsEditCopy" :key="idx"
                                        class="flex items-center gap-2">
                                        <input
                                            class="flex-1 px-2 py-1 border rounded-md bg-background text-xs font-mono"
                                            :value="row.key" placeholder="Key..."
                                            @input="updateEditKey(idx, ($event.target as HTMLInputElement).value)" />
                                        <input
                                            class="flex-1 px-2 py-1 border rounded-md bg-background text-xs font-mono"
                                            :value="row.value" placeholder="Value..."
                                            @input="updateEditValue(idx, ($event.target as HTMLInputElement).value)" />
                                        <button class="p-1 text-muted-foreground hover:text-destructive shrink-0"
                                            @click="removeEditRow(idx)">
                                            <X class="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                    <div
                                        class="flex items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/20 p-3 cursor-pointer hover:border-primary hover:bg-accent/20 transition-colors group"
                                        @click="addTagEditRow">
                                        <div class="flex items-center gap-2 text-muted-foreground/60 group-hover:text-foreground transition-colors">
                                            <Plus class="h-3.5 w-3.5" />
                                            <span class="text-xs font-medium">Add Tag</span>
                                        </div>
                                    </div>
                                    <div class="flex justify-end gap-2">
                                        <button
                                            class="inline-flex items-center justify-center rounded-md text-xs font-medium border border-input bg-background hover:bg-accent h-8 px-3"
                                            @click="cancelEditingTags">
                                            Cancel
                                        </button>
                                        <button
                                            class="inline-flex items-center justify-center rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3"
                                            @click="commitTags">
                                            Apply
                                        </button>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </div>
                </section>

                <!-- Sources -->
                <section class="rounded-lg border bg-card p-6 space-y-4">
                    <div class="flex items-center justify-between">
                        <h2 class="text-lg font-semibold">Sources</h2>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        <div v-for="(source, idx) in project.sources" :key="idx"
                            class="rounded-lg border bg-card p-4 cursor-pointer hover:bg-accent/50 transition-colors flex flex-col"
                            @click="navigateToEditSource(idx)">
                            <div class="min-w-0 flex-1">
                                <TooltipRoot :delay-duration="400">
                                    <TooltipTrigger as-child>
                                        <span class="font-medium block truncate cursor-default"
                                            style="direction: rtl; text-align: left;">
                                            {{ source.directory }}
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom"
                                        class="z-50 max-w-[400px] rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md break-all">
                                        {{ source.directory }}
                                    </TooltipContent>
                                </TooltipRoot>
                                <div class="flex items-center justify-between gap-2 mt-1.5">
                                    <div class="text-sm text-muted-foreground min-w-0">
                                        <span v-if="source.episodeOffset">Offset: {{ source.episodeOffset }}</span>
                                        <span v-if="filesBySource[source.directory]">{{ source.episodeOffset ? ' · ' : '' }}{{
                                            countMatchedFiles(source) }} files</span>
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-2 mt-3">
                                <!-- Copy Filenames button — override episode filenames from this source -->
                                <TooltipRoot :delay-duration="200">
                                    <TooltipTrigger as-child>
                                        <button
                                            class="h-8 px-3 text-xs border rounded-md hover:bg-accent disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-1"
                                            :disabled="queueStore.hasActiveProcessing"
                                            @click.stop="episodeQueueRef?.copyFilenamesFromSource(idx)">
                                            <Copy class="w-3 h-3 shrink-0" />
                                            Use Filenames
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom"
                                        class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                        Replace Episode filenames with filenames from this Source
                                    </TooltipContent>
                                </TooltipRoot>
                                <div class="flex items-center gap-1 ml-auto">
                                    <TooltipRoot :delay-duration="200">
                                        <TooltipTrigger as-child>
                                            <button
                                                class="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                                                @click.stop="showItemInFolder(source.directory)">
                                                <ExternalLink class="w-3.5 h-3.5" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom"
                                            class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                            Show in folder
                                        </TooltipContent>
                                    </TooltipRoot>
                                    <TooltipRoot v-if="queueStore.hasActiveProcessing" :delay-duration="200">
                                        <TooltipTrigger as-child>
                                            <button
                                                class="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                                                disabled @click.stop="removeSource(idx)">
                                                <Trash2 class="h-4 w-4" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom"
                                            class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                            {{ queueStore.lockReason }}
                                        </TooltipContent>
                                    </TooltipRoot>
                                    <TooltipRoot v-else :delay-duration="200">
                                        <TooltipTrigger as-child>
                                            <button
                                                class="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                                @click.stop="removeSource(idx)">
                                                <Trash2 class="h-4 w-4" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom"
                                            class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                            Delete Source
                                        </TooltipContent>
                                    </TooltipRoot>
                                </div>
                            </div>
                        </div>

                        <!-- Add Source skeleton -->
                        <TooltipRoot v-if="queueStore.hasActiveProcessing" :delay-duration="200">
                            <TooltipTrigger as-child>
                                <div
                                    class="flex items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/20 p-4 cursor-pointer opacity-50 pointer-events-none group min-h-[120px]">
                                    <div
                                        class="flex items-center gap-2 text-muted-foreground/60 group-hover:text-foreground transition-colors">
                                        <Plus class="w-4 h-4" />
                                        <span class="text-sm font-medium">Add Source</span>
                                    </div>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent side="bottom"
                                class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                {{ queueStore.lockReason }}
                            </TooltipContent>
                        </TooltipRoot>
                        <div v-else
                            class="flex items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/20 p-4 cursor-pointer hover:border-primary hover:bg-accent/20 transition-colors group min-h-[120px]"
                            @click="navigateToAddSource">
                            <div
                                class="flex items-center gap-2 text-muted-foreground/60 group-hover:text-foreground transition-colors">
                                <Plus class="w-4 h-4" />
                                <span class="text-sm font-medium">Add Source</span>
                            </div>
                        </div>
                    </div>
                </section>
                            </div>
                        </ScrollAreaViewport>
                        <ScrollAreaScrollbar orientation="vertical" class="group w-2.5 bg-muted/20">
                            <ScrollAreaThumb class="bg-muted-foreground/50 group-hover:bg-muted-foreground/80 rounded-full transition-colors" />
                        </ScrollAreaScrollbar>
                        <ScrollAreaCorner />
                    </ScrollAreaRoot>

                    <!-- Right Column: Episode Queue -->
                    <ScrollAreaRoot class="xl:overflow-hidden xl:flex xl:flex-col" type="auto" :style="{ height: '100%' }">
                        <ScrollAreaViewport class="xl:flex-1 xl:min-h-0">
                            <div class="space-y-6">

                <!-- Episode Queue (DnD handled internally) -->
                <section class="rounded-lg border bg-card p-6">
                <EpisodeQueue ref="episodeQueueRef" v-if="queueDataLoaded && project.sources.length > 0" :sources="project.sources" :files-by-source="filesBySource"
                    :tmdb-series="selectedSeries" :rename-modal-open="showRenameModal" />
                </section>

                            </div>
                        </ScrollAreaViewport>
                        <ScrollAreaScrollbar orientation="vertical" class="group w-2.5 bg-muted/20">
                            <ScrollAreaThumb class="bg-muted-foreground/50 group-hover:bg-muted-foreground/80 rounded-full transition-colors" />
                        </ScrollAreaScrollbar>
                        <ScrollAreaCorner />
                    </ScrollAreaRoot>

                </div>
            </div>

                <!-- TMDB Season Browser Modal -->
                <TmdbSeasonBrowser v-model:open="showSeasonBrowser" :series="browserSeries"
                    @close="showSeasonBrowser = false" @update:series="selectedSeries = $event" />
        </main>
    </div>

    <!-- Delete Project Confirmation Dialog -->
    <DialogRoot :open="showDeleteDialog" @update:open="(v) => { if (!v) showDeleteDialog = false; }">
        <DialogContent
            class="fixed left-1/2 top-1/2 z-50 grid w-full max-w-md gap-4 border bg-background p-6 shadow-lg sm:rounded-lg -translate-x-1/2 -translate-y-1/2">
            <DialogTitle class="text-sm font-semibold">Delete Project</DialogTitle>
            <DialogDescription class="text-sm text-muted-foreground">
                Are you sure you want to delete "<span class="font-medium text-foreground">{{ project?.name }}</span>"?
                This
                action cannot be undone.
            </DialogDescription>
            <div class="flex justify-end gap-2 mt-2">
                <DialogClose
                    class="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-4 py-2">
                    Cancel
                </DialogClose>
                <button
                    class="inline-flex items-center justify-center rounded-md text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 h-9 px-4 py-2"
                    @click="deleteProject">
                    Delete
                </button>
            </div>
            <DialogClose
                class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100">
                <span class="sr-only">Close</span>
            </DialogClose>
        </DialogContent>
    </DialogRoot>
    </DnDProvider>
</template>
