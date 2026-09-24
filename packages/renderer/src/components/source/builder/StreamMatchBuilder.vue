<script setup lang="ts">
import { ref } from 'vue';
import { cn } from '@/lib/utils';
import { Plus } from '@lucide/vue';
import type { StreamItem, StreamType } from '@/components/source/types/stream-match-constants';
import { useBuilderCore } from '@/components/source/composables/useBuilderCore';
import { useBuilderVisualRows } from '@/components/source/composables/useBuilderVisualRows';
import { useBuilderModify } from '@/components/source/composables/useBuilderModify';
import { useBuilderPresets } from '@/components/source/composables/useBuilderPresets';
import StreamMatchItem from '@/components/source/builder/StreamMatchItem.vue';
import PresetSaveModal from '@/components/source/presets/PresetSaveModal.vue';
import PresetManagerPopover from '@/components/source/presets/PresetManagerPopover.vue';

defineOptions({ name: 'StreamMatchBuilder' });

interface Props {
    modelValue: StreamItem[];
    streamType: StreamType;
    class?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: StreamItem[]): void;
}>();

// Template ref to the item components so the parent can flush pending JSON edits.
const itemRefs = ref<InstanceType<typeof StreamMatchItem>[]>([]);

/** Flush any pending valid JSON edits in every item so they land before save. */
function flush(): void {
    for (const item of itemRefs.value) {
        item.flush?.();
    }
}

defineExpose({ flush });

// ─── Compose the 4 focused composables ──────────────────────────
// Destructure to top-level so refs auto-unwrap in the template.

const core = useBuilderCore(props, emit);

const {
    getVisualRows,
    getAvailableOperators,
    isNestedOp,
    isTerminalOp,
    addRow,
    removeRow,
    updateRowField,
    updateRowOp,
    updateRowValue,
    togglePatternFlag,
    addSubRow,
    removeSubRow,
    addDispositionMatch,
    removeDispositionMatch,
    updateDispositionValueMatch,
    rowKey,
} = useBuilderVisualRows(props, {
    items: core.items,
    visualRowsByItem: core.visualRowsByItem,
    emitChange: core.emitChange,
});

const modify = useBuilderModify(props, {
    items: core.items,
    emitChange: core.emitChange,
});

const presets = useBuilderPresets(props, {
    items: core.items,
    emitChange: core.emitChange,
    addItem: core.addItem,
    collapsedItems: core.collapsedItems,
});
</script>

<template>
    <div :class="cn('space-y-4', props.class)" @click.stop>
        <StreamMatchItem v-for="item in core.items.value" :key="item.id"
            ref="itemRefs"
            :item="item"
            :stream-type="props.streamType"
            :collapsed="core.isCollapsed(item.id)"
            :editing-name="core.renamingItemId.value === item.id"
            :rename-value="core.renameValue.value"
            :field-defs="core.fieldDefs.value"
            :operator-options="core.operatorOptions"
            :json-schema="core.jsonSchema.value"
            :visual-rows="getVisualRows(item)"
            :has-modify="core.hasModify.value"
            :has-preprocess="core.hasPreprocess.value"
            :active-disposition-labels="modify.getActiveDispositionLabels(item)"
            :available-dispositions="modify.getAvailableDispositions(item)"
            :tag-entries="modify.getTagEntries(item)"
            :modify-count="Object.keys(item.modify ?? {}).length"
            :preprocess-active="!!(item.preprocess?.opusenc && Object.keys(item.preprocess.opusenc as Record<string, unknown>).length > 0)"
            :get-available-operators="getAvailableOperators"
            :is-nested-op="isNestedOp"
            :is-terminal-op="isTerminalOp"
            :row-key="rowKey"
            :preprocess-value="(field: string) => modify.getPreprocessOpens(item, field)"
            @toggle-collapse="core.toggleCollapse(item.id)"
            @start-rename="core.startRename(item.id)"
            @commit-rename="core.commitRename()"
            @update:rename-value="(v) => core.renameValue.value = v"
            @cancel-rename="core.cancelRename()"
            @open-save-modal="presets.openSaveModal(item.id)"
            @remove-item="core.removeItem(item.id)"
            @add-row="addRow(item)"
            @update-row-field="(p, f) => updateRowField(item, p, f)"
            @update-row-op="(p, o) => updateRowOp(item, p, o)"
            @update-row-value="(p, v) => updateRowValue(item, p, v)"
            @toggle-pattern-flag="(p, fl) => togglePatternFlag(item, p, fl)"
            @remove-row="(p) => removeRow(item, p)"
            @add-sub-row="(p) => addSubRow(item, p)"
            @remove-sub-row="(p, i) => removeSubRow(item, p, i)"
            @add-disposition="(p, d) => addDispositionMatch(item, p, d)"
            @remove-disposition="(p, i) => removeDispositionMatch(item, p, i)"
            @update-disposition-value="(p, i, v) => updateDispositionValueMatch(item, p, i, v)"
            @handle-json-change="(v) => core.handleJsonChange(item, v)"
            @handle-modify-json-change="(v) => modify.handleModifyJsonChange(item, v)"
            @handle-preprocess-json-change="(v) => modify.handlePreprocessJsonChange(item, v)"
            @modify-set-field="(f, v) => modify.setModifyField(item, f, v)"
            @modify-set-tag="(k, v) => modify.setModifyTag(item, k, v)"
            @modify-add-tag="modify.addTag(item)"
            @modify-remove-tag="(k) => modify.removeTag(item, k)"
            @modify-rename-tag="(ok, nk, ti) => modify.renameTag(item, ok, nk, ti)"
            @modify-toggle-disposition="(d) => modify.toggleDisposition(item, d)"
            @modify-remove-disposition="(d) => modify.removeDisposition(item, d)"
            @modify-update-disposition-value="(d, v) => modify.updateDispositionValueToModify(item, d, v)"
            @preprocess-set-field="(f, v) => modify.setPreprocessField(item, f, v)" />

        <!-- Add Configuration skeleton -->
        <div v-if="core.items.value.length === 0">
            <PresetManagerPopover :presets="presets.presets.value"
                @add-new="core.addItem"
                @apply-preset="presets.applyPreset"
                @rename-preset="presets.handleRenamePreset"
                @delete-preset="presets.handleDeletePreset">
                <div
                    class="flex items-center justify-center border-2 border-dashed border-muted-foreground/30 rounded-lg py-3 cursor-pointer hover:border-primary hover:bg-accent/20 transition-colors group w-full">
                    <div class="flex items-center gap-2 text-muted-foreground group-hover:text-foreground transition-colors">
                        <Plus class="w-3 h-3" />
                        <span class="text-[11px] font-medium capitalize">Add {{ props.streamType }} Configuration</span>
                    </div>
                </div>
            </PresetManagerPopover>
        </div>
        <div v-else>
            <PresetManagerPopover :presets="presets.presets.value"
                @add-new="core.addItem"
                @apply-preset="presets.applyPreset"
                @rename-preset="presets.handleRenamePreset"
                @delete-preset="presets.handleDeletePreset">
                <div
                    class="flex items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-lg py-3 cursor-pointer hover:border-primary hover:bg-accent/20 transition-colors group w-full">
                    <div class="flex items-center gap-2 text-muted-foreground/60 group-hover:text-foreground transition-colors">
                        <Plus class="w-3 h-3" />
                        <span class="text-[11px] font-medium capitalize">Add {{ props.streamType }} Configuration</span>
                    </div>
                </div>
            </PresetManagerPopover>
        </div>

        <!-- Save modal -->
        <PresetSaveModal :open="presets.saveAsModal.value.open" :name="presets.saveAsModal.value.name"
            :exists="presets.saveAsModal.value.exists" :error="presets.saveAsModal.value.error"
            @confirm="presets.confirmSave" @cancel="presets.cancelSaveModal"
            @update:name="presets.handleSaveInput" />
    </div>
</template>
