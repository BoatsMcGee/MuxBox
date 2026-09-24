<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import { TooltipRoot, TooltipTrigger, TooltipContent } from 'reka-ui';
import { DialogRoot, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui';
import { useRouter, useRoute } from 'vue-router';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { listProjects, saveProject, removeProject } from '@app/preload';
import { createDefaultProjectData } from '@app/preload';
import type { ProjectListItem } from '@app/preload';
import { Settings, Trash2 } from '@lucide/vue';

const router = useRouter();
const route = useRoute();
const projectsStore = useProjectsStore();

const sortedProjects = computed(() =>
    [...projectsStore.projects].sort((a, b) => b.lastOpened - a.lastOpened),
);

function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
}

async function loadProjects() {
    const list = await listProjects();
    projectsStore.setProjectList(list);
}

async function openProject(id: string) {
    projectsStore.setCurrentProject(id);
    router.push({ name: 'project', params: { id } });
}

const deletingProject = ref<{ id: string; name: string } | null>(null);

async function confirmDeleteProject() {
    if (!deletingProject.value) return;
    await removeProject(deletingProject.value.id);
    projectsStore.removeProject(deletingProject.value.id);
    deletingProject.value = null;
}

async function createProject() {
    const id = crypto.randomUUID();
    const data = createDefaultProjectData(id);
    const item: ProjectListItem = {
        id: data.id,
        name: data.name,
        seriesName: data.seriesName,
        sourceCount: 0,
        episodeCount: 0,
        lastOpened: Date.now(),
        createdAt: data.createdAt,
    };
    projectsStore.addProject(item);
    await saveProject({ data, travels: null });
    openProject(id);
}

onMounted(async () => {
    await loadProjects();
    if (projectsStore.projects.length === 0 && route.query.deleted !== '1') {
        await createProject();
    }
});
</script>

<template>
    <div class="flex flex-col items-center justify-center min-h-screen p-8">
        <div class="w-full max-w-2xl">
            <!-- Hero -->
            <div class="flex justify-center mb-6 text-foreground">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="h-40 w-40" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M256,106 C256,106 386,181 386,181 C386,181 256,256 256,256 C256,256 126,181 126,181 C126,181 256,106 256,106 Z"/>
                    <path d="M126,181 C126,181 256,256 256,256 C256,256 256,406 256,406 C256,406 126,331 126,331 C126,331 126,181 126,181 Z"/>
                    <path d="M386,181 C386,181 256,256 256,256 C256,256 256,406 256,406 C256,406 386,331 386,331 C386,331 386,181 386,181 Z"/>
                    <path d="M321,143.5 C321,143.5 191,218.5 191,218.5"/>
                    <path d="M191,143.5 C191,143.5 321,218.5 321,218.5"/>
                </svg>
            </div>
            <!-- Header -->
            <div class="flex items-center justify-between mb-8">
                <div>
                    <h1 class="text-3xl font-bold tracking-tight">MuxBox</h1>
                    <p class="text-muted-foreground mt-1">Batch multiplexer with heuristics-based stream selection</p>
                </div>
                <TooltipRoot :delay-duration="200">
                    <TooltipTrigger as-child>
                        <button
                            class="p-2 rounded-md hover:bg-accent transition-colors"
                            @click="router.push({ name: 'settings' })"
                        >
                            <Settings class="h-5 w-5" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                        Settings
                    </TooltipContent>
                </TooltipRoot>
            </div>

            <!-- Projects Card -->
            <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
                <div class="flex items-center justify-between p-4 border-b">
                    <h2 class="text-lg font-semibold">Projects</h2>
                    <button
                        class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2"
                        @click="createProject"
                    >
                        New Project
                    </button>
                </div>

                <div v-if="sortedProjects.length === 0" class="p-8 text-center text-muted-foreground">
                    No projects yet. Create one to get started.
                </div>

                <div v-else class="divide-y">
                    <div
                        v-for="project in sortedProjects"
                        :key="project.id"
                        class="flex items-center justify-between p-4 cursor-pointer hover:bg-accent/50 transition-colors"
                        @click="openProject(project.id)"
                    >
                        <div class="min-w-0 flex-1">
                            <div class="font-medium truncate">{{ project.name }}</div>
                            <div class="text-sm text-muted-foreground truncate">
                                <span v-if="project.seriesName">{{ project.seriesName }} · </span>
                                <span>{{ project.sourceCount }} source{{ project.sourceCount !== 1 ? 's' : '' }}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                            <TooltipRoot :delay-duration="200">
                                <TooltipTrigger as-child>
                                    <button
                                        class="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                        @click.stop="deletingProject = { id: project.id, name: project.name }"
                                    >
                                        <Trash2 class="h-4 w-4" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                    Delete Project
                                </TooltipContent>
                            </TooltipRoot>
                            <div class="text-xs text-muted-foreground">
                                {{ formatTimeAgo(project.lastOpened) }}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Delete Project Confirmation Dialog -->
    <DialogRoot :open="deletingProject !== null" @update:open="(v) => { if (!v) deletingProject = null; }">
        <DialogContent class="fixed left-1/2 top-1/2 z-50 grid w-full max-w-md gap-4 border bg-background p-6 shadow-lg sm:rounded-lg -translate-x-1/2 -translate-y-1/2">
            <DialogTitle class="text-sm font-semibold">Delete Project</DialogTitle>
            <DialogDescription class="text-sm text-muted-foreground">
                Are you sure you want to delete "<span class="font-medium text-foreground">{{ deletingProject?.name }}</span>"? This action cannot be undone.
            </DialogDescription>
            <div class="flex justify-end gap-2 mt-2">
                <DialogClose
                    class="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-4 py-2"
                >
                    Cancel
                </DialogClose>
                <button
                    class="inline-flex items-center justify-center rounded-md text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 h-9 px-4 py-2"
                    @click="confirmDeleteProject"
                >
                    Delete
                </button>
            </div>
            <DialogClose class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100">
                <span class="sr-only">Close</span>
            </DialogClose>
        </DialogContent>
    </DialogRoot>
</template>
