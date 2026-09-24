import { defineStore } from 'pinia';
import { ref } from 'vue';
import { createTravels, type Travels } from 'travels';
import type { ProjectData } from '@app/preload';

export const useProjectStore = defineStore('project', () => {
    const currentProject = ref<ProjectData | null>(null);
    let travels: Travels<ProjectData> | null = null;

    const canUndo = ref(false);
    const canRedo = ref(false);

    function initProject(data: ProjectData) {
        currentProject.value = data;
        travels = createTravels(data, { maxHistory: 100 });
        travels.subscribe((state) => {
            currentProject.value = state;
            canUndo.value = travels?.canBack() ?? false;
            canRedo.value = travels?.canForward() ?? false;
        });
        canUndo.value = false;
        canRedo.value = false;
    }

    function updateProject(updater: (draft: ProjectData) => void) {
        if (!travels) return;
        travels.setState(updater);
    }

    function undo() {
        if (!travels) return;
        travels.back();
        currentProject.value = travels.getState();
        canUndo.value = travels.canBack();
        canRedo.value = travels.canForward();
    }

    function redo() {
        if (!travels) return;
        travels.forward();
        currentProject.value = travels.getState();
        canUndo.value = travels.canBack();
        canRedo.value = travels.canForward();
    }

    function serialize() {
        return travels?.serialize();
    }

    function loadFromSerialized(data: ProjectData, snapshot: ReturnType<NonNullable<typeof travels>['serialize']>) {
        currentProject.value = data;
        travels = createTravels(data, {
            maxHistory: 100,
            history: snapshot,
        });
        travels.subscribe((state) => {
            currentProject.value = state;
            canUndo.value = travels?.canBack() ?? false;
            canRedo.value = travels?.canForward() ?? false;
        });
        canUndo.value = travels?.canBack() ?? false;
        canRedo.value = travels?.canForward() ?? false;
    }

    return {
        currentProject,
        canUndo,
        canRedo,
        initProject,
        updateProject,
        undo,
        redo,
        serialize,
        loadFromSerialized,
    };
});
