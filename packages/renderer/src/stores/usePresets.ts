import { ref, watch, type Ref } from 'vue';
import {
    listPresets as preloadListPresets,
    loadPreset as preloadLoadPreset,
    savePreset as preloadSavePreset,
    deletePreset as preloadDeletePreset,
} from '@app/preload';
import type { PresetData, PresetMeta } from '@app/preload';

export type StreamType = 'video' | 'audio' | 'subtitle' | 'attachment';

export interface PresetItem {
    name: string;
    streamType: StreamType;
    modifiedAt: string;
}

export function usePresets(streamType: Ref<StreamType>) {
    const presets = ref<PresetItem[]>([]);
    const loading = ref(false);

    async function refreshPresets(): Promise<void> {
        loading.value = true;
        try {
            const metas = await preloadListPresets(streamType.value);
            presets.value = metas.map((meta: PresetMeta) => ({
                name: meta.name,
                streamType: meta.streamType as StreamType,
                modifiedAt: meta.modifiedAt,
            }));
        } catch (err) {
            console.error('Failed to list presets:', err);
            presets.value = [];
        } finally {
            loading.value = false;
        }
    }

    async function loadPreset(name: string): Promise<PresetData> {
        return preloadLoadPreset(streamType.value, name).then((d) => JSON.parse(JSON.stringify(d)));
    }

    async function savePreset(name: string, data: PresetData): Promise<void> {
        // Deep clone to strip Vue reactive proxies before passing through contextBridge
        const clean = JSON.parse(JSON.stringify(data));
        await preloadSavePreset(streamType.value, name, clean);
        await refreshPresets();
    }

    async function renamePreset(oldName: string, newName: string): Promise<void> {
        if (oldName === newName) return;
        const data = await loadPreset(oldName);
        // Update the name stored inside the JSON payload too
        data.name = newName;
        await deletePreset(oldName);
        await savePreset(newName, data);
        // savePreset already calls refreshPresets
    }

    async function deletePreset(name: string): Promise<void> {
        await preloadDeletePreset(streamType.value, name);
        await refreshPresets();
    }

    // Auto-refresh when stream type changes
    watch(streamType, () => {
        refreshPresets();
    }, { immediate: true });

    return {
        presets,
        loading,
        refreshPresets,
        loadPreset,
        savePreset,
        renamePreset,
        deletePreset,
    };
}
