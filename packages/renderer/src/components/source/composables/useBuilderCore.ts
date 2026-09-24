import { ref, watch, computed, onMounted, onUnmounted, nextTick, type Ref } from 'vue';
import type { StreamItem, StreamType } from '@/components/source/types/stream-match-constants';
import { DEFAULT_ITEM_NAMES } from '@/components/source/types/stream-match-constants';
import type { FieldDef, VisualRow } from '@/components/source/types/stream-match-types';
import { getFieldDefs } from '@/components/source/config/field-definitions';
import { operatorOptions } from '@/components/source/config/operator-options';
import { matchToVisualRows } from '@/components/source/utils/visual-rows';
import {
    videoMatchJSONSchema,
    audioMatchJSONSchema,
    subtitleMatchJSONSchema,
    attachmentMatchJSONSchema,
} from '@/lib/sury-schema';

export function useBuilderCore(
    props: { modelValue: StreamItem[]; streamType: StreamType },
    emit: (e: 'update:modelValue', value: StreamItem[]) => void,
) {
    // ─── Derived ────────────────────────────────────────────────

    const fieldDefs = computed<FieldDef[]>(() => getFieldDefs(props.streamType));

    const jsonSchema = computed(() => {
        switch (props.streamType) {
            case 'video': return videoMatchJSONSchema;
            case 'audio': return audioMatchJSONSchema;
            case 'subtitle': return subtitleMatchJSONSchema;
            case 'attachment': return attachmentMatchJSONSchema;
            default: return videoMatchJSONSchema;
        }
    });

    const hasModify = computed(() => props.streamType !== 'attachment');
    const hasPreprocess = computed<boolean>(() => props.streamType === 'audio');

    // ─── Items state ────────────────────────────────────────────

    const items = ref<StreamItem[]>([]);
    const visualRowsByItem = ref(new Map<string, VisualRow[]>()) as Ref<Map<string, VisualRow[]>>;
    const collapsedItems = ref<Set<string>>(new Set());

    function toggleCollapse(id: string) {
        const s = new Set(collapsedItems.value);
        if (s.has(id)) {
            s.delete(id);
        } else {
            s.add(id);
        }
        collapsedItems.value = s;
    }

    function isCollapsed(id: string): boolean {
        return collapsedItems.value.has(id);
    }

    // ─── Rename state ───────────────────────────────────────────

    const renamingItemId = ref<string | null>(null);
    const renameValue = ref('');

    function startRename(id: string) {
        const item = items.value.find((i) => i.id === id);
        if (item) {
            renameValue.value = item.name ?? DEFAULT_ITEM_NAMES[props.streamType];
            renamingItemId.value = id;
            nextTick(() => {
                const input = document.querySelector<HTMLInputElement>('.rename-input.active');
                input?.focus();
                input?.select();
            });
        }
    }

    function commitRename() {
        if (renamingItemId.value) {
            const item = items.value.find((i) => i.id === renamingItemId.value);
            if (item) {
                const trimmed = renameValue.value.trim();
                item.name = trimmed || DEFAULT_ITEM_NAMES[props.streamType];
                emitChange();
            }
        }
        renamingItemId.value = null;
    }

    function cancelRename() {
        renamingItemId.value = null;
        renameValue.value = '';
    }

    // ─── Close helpers ──────────────────────────────────────────

    function closeAllDropdowns() {
        // Presets call this to close modal — we keep a stub here so the
        // composable contract is clear. The presets composable manages its own state.
    }

    // ─── Sync from modelValue ──────────────────────────────────

    watch(
        () => props.modelValue,
        (val) => {
            if (val && val.length > 0) {
                const newItems = val.map((item) => ({
                    id: item.id || crypto.randomUUID(),
                    name: item.name ?? DEFAULT_ITEM_NAMES[props.streamType],
                    match: { ...item.match },
                    modify: item.modify ? { ...item.modify } : undefined,
                    preprocess: item.preprocess ? { ...item.preprocess } : undefined,
                }));
                const prevIds = new Set(items.value.map(i => i.id));
                items.value = newItems;
                const collapseSet = new Set(collapsedItems.value);
                for (const newItem of newItems) {
                    if (!prevIds.has(newItem.id)) {
                        collapseSet.add(newItem.id);
                    }
                    if (!visualRowsByItem.value.has(newItem.id)) {
                        const parsed = matchToVisualRows(newItem.match, fieldDefs.value);
                        if (parsed.length > 0) {
                            visualRowsByItem.value.set(newItem.id, parsed);
                        }
                    }
                }
                collapsedItems.value = collapseSet;
            } else {
                items.value = [];
                visualRowsByItem.value = new Map();
            }
        },
        { immediate: true },
    );

    function emitChange() {
        emit(
            'update:modelValue',
            items.value.map((item) => {
                const out: StreamItem = {
                    id: item.id,
                    name: item.name ?? DEFAULT_ITEM_NAMES[props.streamType],
                    match: { ...item.match },
                };
                if (item.modify && Object.keys(item.modify).length > 0) {
                    out.modify = { ...item.modify };
                }
                if (item.preprocess && Object.keys(item.preprocess).length > 0) {
                    out.preprocess = { ...item.preprocess };
                }
                return out;
            }),
        );
    }

    // ─── Item CRUD ──────────────────────────────────────────────

    function addItem(id?: string, presetName?: string, presetMatch?: Record<string, unknown>, presetModify?: Record<string, unknown>, presetPreprocess?: Record<string, unknown>) {
        const itemId = id ?? crypto.randomUUID();
        items.value.push({
            id: itemId,
            name: presetName ?? DEFAULT_ITEM_NAMES[props.streamType],
            match: presetMatch ?? {},
            modify: presetModify,
            preprocess: presetPreprocess,
        });
        emitChange();
    }

    function removeItem(id: string) {
        items.value = items.value.filter((item) => item.id !== id);
        visualRowsByItem.value.delete(id);
        emitChange();
    }

    // ─── JSON sync ──────────────────────────────────────────────

    function handleJsonChange(item: StreamItem, newVal: unknown) {
        if (newVal && typeof newVal === 'object') {
            item.match = newVal as Record<string, unknown>;
            // Invalidate visual rows cache so next getVisualRows re-parses from updated match
            visualRowsByItem.value.delete(item.id);
            emitChange();
        }
    }

    // ─── Click-away handler ─────────────────────────────────────

    let clickAwayCleanup: (() => void) | null = null;

    onMounted(() => {
        function handleClickAway(e: MouseEvent) {
            const target = e.target as HTMLElement;
            if (!target.closest('[data-dropdown-container]') && !target.closest('[data-add-preset-container]') && !target.closest('[data-modal-container]')) {
                closeAllDropdowns();
            }
        }
        document.addEventListener('click', handleClickAway);
        clickAwayCleanup = () => document.removeEventListener('click', handleClickAway);
    });

    onUnmounted(() => {
        clickAwayCleanup?.();
    });

    // ─── Return ─────────────────────────────────────────────────

    return {
        // State
        items,
        visualRowsByItem,
        collapsedItems,
        renamingItemId,
        renameValue,
        fieldDefs,
        jsonSchema,
        hasModify,
        hasPreprocess,
        operatorOptions,

        // Methods
        emitChange,
        toggleCollapse,
        isCollapsed,
        startRename,
        commitRename,
        cancelRename,
        addItem,
        removeItem,
        handleJsonChange,
        closeAllDropdowns,
    };
}
