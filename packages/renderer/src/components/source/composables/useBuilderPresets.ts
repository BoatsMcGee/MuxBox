import { ref, computed, type Ref } from 'vue';
import type { StreamItem, StreamType } from '@/components/source/types/stream-match-constants';
import { DEFAULT_ITEM_NAMES } from '@/components/source/types/stream-match-constants';
import type { PresetData } from '@app/preload';
import { usePresets } from '@/stores/usePresets';

interface PresetsContext {
    items: Ref<StreamItem[]>;
    emitChange: () => void;
    addItem: (id?: string, presetName?: string, match?: Record<string, unknown>, modify?: Record<string, unknown>, preprocess?: Record<string, unknown>) => void;
    collapsedItems: Ref<Set<string>>;
}

// ─── Save modal state shape ─────────────────────────────────────

interface SaveModalState {
    open: boolean;
    itemId: string | null;
    name: string;
    exists: boolean;
    error: string;
}

export function useBuilderPresets(
    props: { streamType: StreamType },
    ctx: PresetsContext,
) {
    const { items, emitChange, addItem, collapsedItems } = ctx;

    const streamTypeRef = computed(() => props.streamType);
    const { presets, loadPreset, savePreset, renamePreset, deletePreset } = usePresets(streamTypeRef);

    // ─── Save modal state ───────────────────────────────────────

    const saveAsModal = ref<SaveModalState>({
        open: false,
        itemId: null,
        name: '',
        exists: false,
        error: '',
    });

    function isPresetNameTaken(name: string): boolean {
        const trimmed = name.trim();
        if (!trimmed) return false;
        return presets.value.some((p) => p.name === trimmed);
    }

    function openSaveModal(itemId: string) {
        const item = items.value.find((i) => i.id === itemId);
        const defaultName = item?.name ?? DEFAULT_ITEM_NAMES[props.streamType];
        saveAsModal.value = {
            open: true,
            itemId,
            name: defaultName,
            exists: isPresetNameTaken(defaultName),
            error: '',
        };
    }

    function confirmSave() {
        const modal = saveAsModal.value;
        if (!modal.itemId) return;
        const item = items.value.find((i) => i.id === modal.itemId);
        const name = modal.name.trim();
        if (!name || !item) return;

        const data: PresetData = {
            name,
            match: { ...item.match },
            modify: item.modify ? { ...item.modify } : undefined,
            preprocess: item.preprocess ? { ...item.preprocess } : undefined,
            streamType: props.streamType,
        };

        savePreset(name, data).then(() => {
            item.name = name;
            emitChange();
            closeAllDropdowns();
        }).catch((err) => {
            console.error('Failed to save preset:', err);
            modal.error = 'Failed to save preset';
        });
    }

    function cancelSaveModal() {
        closeAllDropdowns();
    }

    function handleSaveInput(val: string) {
        saveAsModal.value.name = val;
        saveAsModal.value.exists = isPresetNameTaken(val);
        saveAsModal.value.error = '';
    }

    function closeAllDropdowns() {
        saveAsModal.value = { open: false, itemId: null, name: '', exists: false, error: '' };
    }

    // ─── Apply preset to items ──────────────────────────────────

    async function applyPreset(presetName: string) {
        try {
            const preset = await loadPreset(presetName);
            const id = crypto.randomUUID();
            addItem(
                id,
                preset.name,
                preset.match ?? {},
                preset.modify ? { ...preset.modify } : undefined,
                preset.preprocess ? { ...preset.preprocess } : undefined,
            );
            // Add preset as collapsed so it doesn't take up too much space
            collapsedItems.value = new Set(collapsedItems.value).add(id);
            emitChange();
        } catch (err) {
            console.error('Failed to load preset:', err);
        }
    }

    // ─── Preset management ──────────────────────────────────────

    async function handleRenamePreset(oldName: string, newName: string): Promise<void> {
        try {
            await renamePreset(oldName, newName);
        } catch (err) {
            console.error('Failed to rename preset:', err);
        }
    }

    async function handleDeletePreset(name: string): Promise<void> {
        try {
            await deletePreset(name);
        } catch (err) {
            console.error('Failed to delete preset:', err);
        }
    }

    // ─── Return ─────────────────────────────────────────────────

    return {
        saveAsModal,
        presets,

        openSaveModal,
        confirmSave,
        cancelSaveModal,
        handleSaveInput,
        applyPreset,
        handleRenamePreset,
        handleDeletePreset,
    };
}
