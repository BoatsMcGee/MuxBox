import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { ProjectListItem, ProjectData } from '@app/preload';

export const useProjectsStore = defineStore('projects', () => {
    const projects = ref<ProjectListItem[]>([]);
    const currentProjectId = ref<string | null>(null);

    const sortedProjects = computed(() =>
        [...projects.value].sort((a, b) => b.lastOpened - a.lastOpened),
    );

    const currentProject = computed(() =>
        projects.value.find((p) => p.id === currentProjectId.value) ?? null,
    );

    function setProjectList(list: ProjectListItem[]) {
        projects.value = list;
    }

    function addProject(item: ProjectListItem) {
        const existing = projects.value.findIndex((p) => p.id === item.id);
        if (existing >= 0) {
            projects.value[existing] = item;
        } else {
            projects.value.push(item);
        }
    }

    function removeProject(id: string) {
        projects.value = projects.value.filter((p) => p.id !== id);
    }

    function setCurrentProject(id: string | null) {
        currentProjectId.value = id;
    }

    function updateFromData(data: ProjectData) {
        const existing = projects.value.findIndex((p) => p.id === data.id);
        const item: ProjectListItem = {
            id: data.id,
            name: data.name,
            seriesName: data.seriesName,
            sourceCount: data.sources.length,
            episodeCount: 0,
            lastOpened: Date.now(),
            createdAt: data.createdAt,
        };
        if (existing >= 0) {
            projects.value[existing] = item;
        } else {
            projects.value.push(item);
        }
    }

    return {
        projects,
        sortedProjects,
        currentProjectId,
        currentProject,
        setProjectList,
        addProject,
        removeProject,
        setCurrentProject,
        updateFromData,
    };
});
