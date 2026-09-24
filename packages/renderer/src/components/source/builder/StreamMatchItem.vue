<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { TooltipRoot, TooltipTrigger, TooltipContent } from 'reka-ui';
import { PopoverRoot, PopoverTrigger, PopoverContent } from 'reka-ui';
import { ChevronDown, ChevronRight, Pencil, Save, X, Form, Braces, Plus } from '@lucide/vue';
import UiBadge from '@/components/ui/ui-badge.vue';
import UiButton from '@/components/ui/ui-button.vue';
import MonacoJsonEditor from '@/components/editor/MonacoJsonEditor.vue';
import { useToast } from '@/components/ui/useToast';
import StreamMatchRow from '@/components/source/rules/StreamMatchRow.vue';
import StreamMatchModifyPanel from '@/components/source/rules/StreamMatchModifyPanel.vue';
import StreamMatchPreprocessPanel from '@/components/source/rules/StreamMatchPreprocessPanel.vue';
import type { VisualRow, FieldDef, OperatorOption } from '@/components/source/types/stream-match-types';
import type { StreamItem, StreamType, TagEntry, DispositionOption } from '@/components/source/types/stream-match-constants';
import { DEFAULT_ITEM_NAMES } from '@/components/source/types/stream-match-constants';

defineOptions({ name: 'StreamMatchItem' });

interface Props {
    item: StreamItem;
    streamType: StreamType;
    collapsed: boolean;
    editingName: boolean;
    renameValue: string;
    fieldDefs: FieldDef[];
    operatorOptions: OperatorOption[];
    jsonSchema: Record<string, unknown>;
    visualRows: VisualRow[];
    hasModify: boolean;
    hasPreprocess: boolean;
    activeDispositionLabels: DispositionOption[];
    availableDispositions: DispositionOption[];
    tagEntries: TagEntry[];
    modifyCount: number;
    preprocessActive: boolean;
    getAvailableOperators: (field: string) => OperatorOption[];
    isNestedOp: (op: string) => boolean;
    isTerminalOp: (op: string) => boolean;
    rowKey: (itemId: string, rowIdx: number) => string;
    preprocessValue: (field: string) => unknown;
}

const props = defineProps<Props>();

const emit = defineEmits<{
    (e: 'toggle-collapse'): void;
    (e: 'start-rename'): void;
    (e: 'commit-rename'): void;
    (e: 'cancel-rename'): void;
    (e: 'update:rename-value', value: string): void;
    (e: 'open-save-modal'): void;
    (e: 'remove-item'): void;
    (e: 'add-row'): void;
    (e: 'update-row-field', path: number[], field: string): void;
    (e: 'update-row-op', path: number[], op: string): void;
    (e: 'update-row-value', path: number[], value: string): void;
    (e: 'toggle-pattern-flag', path: number[], flag: string): void;
    (e: 'remove-row', path: number[]): void;
    (e: 'add-sub-row', path: number[]): void;
    (e: 'remove-sub-row', path: number[], subIndex: number): void;
    (e: 'handle-json-change', value: unknown): void;
    (e: 'handle-modify-json-change', value: unknown): void;
    (e: 'handle-preprocess-json-change', value: unknown): void;
    // Modify panel
    (e: 'modify-set-field', field: string, value: unknown): void;
    (e: 'modify-set-tag', key: string, value: string): void;
    (e: 'modify-add-tag'): void;
    (e: 'modify-remove-tag', key: string): void;
    (e: 'modify-rename-tag', oldKey: string, newKey: string, tagIdx: number): void;
    (e: 'modify-toggle-disposition', dispKey: string): void;
    (e: 'modify-remove-disposition', dispKey: string): void;
    (e: 'modify-update-disposition-value', dispKey: string, value: boolean): void;
    // Disposition match helpers (visual builder)
    (e: 'add-disposition', path: number[], dispKey?: string): void;
    (e: 'remove-disposition', path: number[], subIndex: number): void;
    (e: 'update-disposition-value', path: number[], subIndex: number, value: boolean): void;
    // Preprocess panel
    (e: 'preprocess-set-field', field: string, value: unknown): void;
}>();

// ─── Editor refs (template refs on MonacoJsonEditor) ──────────

const filterEditorRef = ref<InstanceType<typeof MonacoJsonEditor> | null>(null);
const modifyEditorRef = ref<InstanceType<typeof MonacoJsonEditor> | null>(null);
const preprocessEditorRef = ref<InstanceType<typeof MonacoJsonEditor> | null>(null);

const editorRefMap: Record<string, typeof filterEditorRef> = {
    filter: filterEditorRef,
    modify: modifyEditorRef,
    preprocess: preprocessEditorRef,
};

// ─── Toast ───────────────────────────────────────────────────

const toast = useToast();

// ─── Mode-switch guard (JSON → Visual) ──────────────────────

function canSwitchToVisual(section: 'filter' | 'modify' | 'preprocess'): boolean {
    const editor = editorRefMap[section]?.value;
    if (!editor) return true;

    // Flush any pending valid JSON edit so it lands in item.match before we
    // switch to Visual. No-op when the editor is invalid or has nothing pending.
    editor.flush?.();

    // If in diff mode, exit diff first so errors become visible
    if (editor.showDiff) {
        editor.exitDiff();
        // Return false so user can see errors and click Visual again
        return false;
    }

    if (!editor.hasErrors) return true;

    const messages = editor.errorMessages.slice(0, 10).join('\n');
    const suffix = editor.errorMessages.length > 10 ? `\n…and ${editor.errorMessages.length - 10} more` : '';
    toast.showError(
        `Cannot switch to Visual (${section})`,
        `Fix these JSON errors first:\n${messages}${suffix}`,
    );
    return false;
}

/**
 * Flush any pending valid JSON edits in all sections (filter, modify,
 * preprocess) so they land in item.match before the parent saves.
 */
function flushAllEditors(): void {
    for (const section of ['filter', 'modify', 'preprocess'] as const) {
        editorRefMap[section]?.value?.flush?.();
    }
}

defineExpose({ flush: flushAllEditors });

// ─── Per-section mode state (local, not persisted) ──────────────

const sectionMode = reactive<Record<string, 'visual' | 'json'>>({
    filter: 'visual',
    modify: 'visual',
    preprocess: 'visual',
});

// ─── Accordion open state (single-active) ──────────────────────

const activeSection = ref<'filter' | 'modify' | 'preprocess' | null>(null);

function toggleSection(name: 'filter' | 'modify' | 'preprocess') {
    activeSection.value = activeSection.value === name ? null : name;
}

// ─── Filter field badges ───────────────────────────────────────

const filterFieldLabels = computed(() => {
    return props.visualRows.map((row) => {
        const def = props.fieldDefs.find(d => d.value === row.field);
        return def?.label ?? row.field;
    });
});

// ─── Badge overflow (simple fixed-limit) ──────────────────────

const MAX_VISIBLE_BADGES = 3;

const visibleLabels = computed(() => {
    const labels = filterFieldLabels.value;
    if (labels.length <= MAX_VISIBLE_BADGES) return labels;
    return labels.slice(0, MAX_VISIBLE_BADGES);
});

const overflowLabels = computed(() => {
    const labels = filterFieldLabels.value;
    if (labels.length <= MAX_VISIBLE_BADGES) return [];
    return labels.slice(MAX_VISIBLE_BADGES);
});

const hasOverflow = computed(() => overflowLabels.value.length > 0);

// ─── Inline rename helpers ─────────────────────────────────────

function handleNameClick() {
    if (!props.editingName) {
        emit('start-rename');
    }
}
</script>

<template>
    <div class="border rounded-md p-2">
        <!-- ── Item header (clickable to toggle expand) ────────── -->
        <div class="flex items-center justify-between cursor-pointer select-none" @click="emit('toggle-collapse')">
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <!-- Collapse chevron -->
                <span class="text-muted-foreground shrink-0">
                    <ChevronDown v-if="!collapsed" class="w-3.5 h-3.5" />
                    <ChevronRight v-else class="w-3.5 h-3.5" />
                </span>

                <!-- Inline rename input -->
                <template v-if="editingName">
                    <input :value="renameValue"
                        class="rename-input active flex-1 px-2 py-0.5 text-xs border rounded-md bg-background font-medium min-w-0"
                        placeholder="Configuration name..." @click.stop
                        @input="emit('update:rename-value', ($event.target as HTMLInputElement).value)"
                        @keyup.enter="emit('commit-rename')" @keyup.escape="emit('cancel-rename')"
                        @blur="emit('commit-rename')" />
                </template>
                <!-- Display name with hover pencil -->
                <template v-else>
                    <div class="item-name-group inline-flex items-center gap-1 cursor-pointer rounded px-1 -ml-1 truncate max-w-full hover:bg-accent"
                        @click.stop="handleNameClick">
                        <span class="text-xs font-medium truncate">
                            {{ item.name ?? DEFAULT_ITEM_NAMES[streamType] }}
                        </span>
                        <Pencil class="rename-icon w-2.5 h-2.5 text-muted-foreground shrink-0" />
                    </div>
                </template>
                <!-- Save as preset button -->
                <TooltipRoot :delay-duration="200">
                    <TooltipTrigger as-child>
                        <UiButton variant="ghost" size="icon-sm" @click="emit('open-save-modal')">
                            <Save class="w-3 h-3" />
                        </UiButton>
                    </TooltipTrigger>
                    <TooltipContent side="top"
                        class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                        Save As...
                    </TooltipContent>
                </TooltipRoot>
            </div>

            <div class="flex items-center gap-1" @click.stop>
                <!-- Remove button -->
                <TooltipRoot :delay-duration="200">
                    <TooltipTrigger as-child>
                        <UiButton variant="ghost" size="icon-sm" class="text-muted-foreground hover:text-destructive"
                            @click="emit('remove-item')">
                            <X class="w-3 h-3" />
                        </UiButton>
                    </TooltipTrigger>
                    <TooltipContent side="top"
                        class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                        Remove Configuration
                    </TooltipContent>
                </TooltipRoot>
            </div>
        </div>

        <!-- ── Expanded body ──────────────────────────────────── -->
        <div v-if="!collapsed" class="mt-2 space-y-0.5 border-t pt-2">
            <!-- ── Filter accordion section ──────────────────────── -->
            <div>
                <div class="flex items-center justify-between -mx-1 px-1 py-1 rounded cursor-pointer hover:bg-accent/40 transition-colors"
                    @click="toggleSection('filter')">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <ChevronDown v-if="activeSection === 'filter'" class="w-3 h-3 shrink-0 text-muted-foreground" />
                        <ChevronRight v-else class="w-3 h-3 shrink-0 text-muted-foreground" />
                        <span class="text-[11px] font-medium whitespace-nowrap">Filter</span>
                        <!-- Filter field badges -->
                        <div v-if="activeSection !== 'filter' && filterFieldLabels.length > 0"
                            class="flex items-center gap-1 overflow-hidden min-w-0">
                            <UiBadge v-for="label in visibleLabels" :key="label" variant="secondary"
                                class="text-[10px] px-1.5 py-0 shrink-0">
                                {{ label }}
                            </UiBadge>
                            <PopoverRoot v-if="hasOverflow">
                                <PopoverTrigger as-child>
                                    <UiBadge variant="secondary"
                                        class="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-accent">
                                        +{{ overflowLabels.length }} More
                                    </UiBadge>
                                </PopoverTrigger>
                                <PopoverContent side="bottom" align="start" :side-offset="2"
                                    class="z-50 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-md min-w-20">
                                    <div class="flex flex-wrap gap-1">
                                        <UiBadge v-for="label in overflowLabels" :key="label" variant="secondary"
                                            class="text-[10px] px-1.5 py-0">
                                            {{ label }}
                                        </UiBadge>
                                    </div>
                                </PopoverContent>
                            </PopoverRoot>
                        </div>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        <!-- Filter: Visual/JSON toggle -->
                        <div class="flex rounded border overflow-hidden" @click.stop>
                            <TooltipRoot :delay-duration="200">
                                <TooltipTrigger as-child>
                                    <button class="p-1" :class="sectionMode.filter === 'visual'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-background text-muted-foreground hover:bg-accent'"
                                        @click="canSwitchToVisual('filter') && (sectionMode.filter = 'visual')">
                                        <Form class="w-3 h-3" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="top"
                                    class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                    Visual
                                </TooltipContent>
                            </TooltipRoot>
                            <TooltipRoot :delay-duration="200">
                                <TooltipTrigger as-child>
                                    <button class="p-1 border-l relative" :class="sectionMode.filter === 'json'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-background text-muted-foreground hover:bg-accent'"
                                        @click="sectionMode.filter = 'json'">
                                        <Braces class="w-3 h-3" />
                                        <!-- Dirty / error indicator dot -->
                                        <span v-if="filterEditorRef?.isDirty || filterEditorRef?.hasErrors"
                                            class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
                                            :class="filterEditorRef?.hasErrors ? 'bg-destructive' : 'bg-orange-400'"
                                        />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="top"
                                    class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                    JSON
                                </TooltipContent>
                            </TooltipRoot>
                        </div>
                    </div>
                </div>
                <!-- Filter content -->
                <div v-if="activeSection === 'filter'" class="mt-1 pl-3 border-l-2 border-muted space-y-1">
                    <template v-if="sectionMode.filter === 'visual'">
                        <StreamMatchRow v-for="(row, rowIdx) in visualRows" :key="rowKey(item.id, rowIdx)"
                            :path="[rowIdx]" :row="row" :field="row.field" :field-defs="fieldDefs"
                            :operator-options="operatorOptions" :get-available-operators="getAvailableOperators"
                            :is-terminal-op="isTerminalOp" :is-nested-op="isNestedOp" :depth="0"
                            :used-fields="visualRows.filter((_, i) => i !== rowIdx).map(r => r.field)"
                            @update-row-field="(p, f) => emit('update-row-field', p, f)"
                            @update-row-op="(p, o) => emit('update-row-op', p, o)"
                            @update-row-value="(p, v) => emit('update-row-value', p, v)"
                            @toggle-pattern-flag="(p, fl) => emit('toggle-pattern-flag', p, fl)"
                            @remove-row="(p) => emit('remove-row', p)" @add-sub-row="(p) => emit('add-sub-row', p)"
                            @remove-sub-row="(p, i) => emit('remove-sub-row', p, i)"
                            @add-disposition="(p, d) => emit('add-disposition', p, d)"
                            @remove-disposition="(p, i) => emit('remove-disposition', p, i)"
                            @update-disposition-value="(p, i, v) => emit('update-disposition-value', p, i, v)" />

                        <!-- Add filter skeleton -->
                        <div class="flex items-center justify-center border border-dashed border-muted-foreground/20 rounded py-1 cursor-pointer hover:border-primary hover:bg-accent/20 transition-colors group"
                            @click="emit('add-row')">
                            <div
                                class="flex items-center gap-1 text-muted-foreground/60 group-hover:text-foreground transition-colors">
                                <Plus class="w-3 h-3" />
                                <span class="text-[10px] font-medium">Add filter</span>
                            </div>
                        </div>
                    </template>
                    <template v-else>
                        <MonacoJsonEditor ref="filterEditorRef" :model-value="item.match" :schema="jsonSchema"
                            @update:model-value="emit('handle-json-change', $event)" />
                    </template>
                </div>
            </div>

            <!-- ── Modify accordion section ────────────────────── -->
            <template v-if="hasModify">
                <div>
                    <div class="flex items-center justify-between -mx-1 px-1 py-1 rounded cursor-pointer hover:bg-accent/40 transition-colors"
                        @click="toggleSection('modify')">
                        <div class="flex items-center gap-1.5">
                            <ChevronDown v-if="activeSection === 'modify'"
                                class="w-3 h-3 shrink-0 text-muted-foreground" />
                            <ChevronRight v-else class="w-3 h-3 shrink-0 text-muted-foreground" />
                            <span class="text-[11px] font-medium">Modify</span>
                            <span v-if="modifyCount > 0">
                                <UiBadge variant="secondary" class="text-[10px] px-1.5 py-0">
                                    {{ modifyCount }}
                                </UiBadge>
                            </span>
                        </div>
                        <div class="flex items-center gap-1 shrink-0">
                            <!-- Modify: Visual/JSON toggle -->
                            <div class="flex rounded border overflow-hidden">
                                <TooltipRoot :delay-duration="200">
                                    <TooltipTrigger as-child>
                                        <button class="p-1" :class="sectionMode.modify === 'visual'
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-background text-muted-foreground hover:bg-accent'"
                                            @click.stop="canSwitchToVisual('modify') && (sectionMode.modify = 'visual')">
                                            <Form class="w-3 h-3" />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top"
                                        class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                        Visual
                                    </TooltipContent>
                                </TooltipRoot>
                                <TooltipRoot :delay-duration="200">
                                    <TooltipTrigger as-child>
                                        <button class="p-1 border-l relative" :class="sectionMode.modify === 'json'
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-background text-muted-foreground hover:bg-accent'"
                                            @click.stop="sectionMode.modify = 'json'">
                                            <Braces class="w-3 h-3" />
                                            <!-- Dirty / error indicator dot -->
                                            <span v-if="modifyEditorRef?.isDirty || modifyEditorRef?.hasErrors"
                                                class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
                                                :class="modifyEditorRef?.hasErrors ? 'bg-destructive' : 'bg-orange-400'"
                                            />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top"
                                        class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                        JSON
                                    </TooltipContent>
                                </TooltipRoot>
                            </div>
                        </div>
                    </div>
                    <div v-if="activeSection === 'modify'" class="mt-1 pl-3 border-l-2 border-muted space-y-1">
                        <template v-if="sectionMode.modify === 'visual'">
                            <StreamMatchModifyPanel :item="item" :stream-type="streamType"
                                :active-disposition-labels="activeDispositionLabels"
                                :available-dispositions="availableDispositions" :tag-entries="tagEntries"
                                :modify-count="modifyCount" @set-field="(f, v) => emit('modify-set-field', f, v)"
                                @set-tag="(k, v) => emit('modify-set-tag', k, v)" @add-tag="emit('modify-add-tag')"
                                @remove-tag="(k) => emit('modify-remove-tag', k)"
                                @rename-tag="(ok, nk, ti) => emit('modify-rename-tag', ok, nk, ti)"
                                @toggle-disposition="(d) => emit('modify-toggle-disposition', d)"
                                @remove-disposition="(d) => emit('modify-remove-disposition', d)"
                                @update-disposition-value="(d, v) => emit('modify-update-disposition-value', d, v)" />
                        </template>
                        <template v-else>
                            <MonacoJsonEditor ref="modifyEditorRef" :model-value="item.modify ?? {}"
                                @update:model-value="emit('handle-modify-json-change', $event)" />
                        </template>
                    </div>
                </div>
            </template>

            <!-- ── Preprocess accordion section ────────────────── -->
            <template v-if="hasPreprocess">
                <div>
                    <div class="flex items-center justify-between -mx-1 px-1 py-1 rounded cursor-pointer hover:bg-accent/40 transition-colors"
                        @click="toggleSection('preprocess')">
                        <div class="flex items-center gap-1.5">
                            <ChevronDown v-if="activeSection === 'preprocess'"
                                class="w-3 h-3 shrink-0 text-muted-foreground" />
                            <ChevronRight v-else class="w-3 h-3 shrink-0 text-muted-foreground" />
                            <span class="text-[11px] font-medium">Preprocess</span>
                            <span v-if="preprocessActive">
                                <UiBadge variant="secondary" class="text-[10px] px-1.5 py-0">
                                    opusenc
                                </UiBadge>
                            </span>
                        </div>
                        <div class="flex items-center gap-1 shrink-0">
                            <!-- Preprocess: Visual/JSON toggle -->
                            <div class="flex rounded border overflow-hidden">
                                <TooltipRoot :delay-duration="200">
                                    <TooltipTrigger as-child>
                                        <button class="p-1" :class="sectionMode.preprocess === 'visual'
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-background text-muted-foreground hover:bg-accent'"
                                            @click.stop="canSwitchToVisual('preprocess') && (sectionMode.preprocess = 'visual')">
                                            <Form class="w-3 h-3" />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top"
                                        class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                        Visual
                                    </TooltipContent>
                                </TooltipRoot>
                                <TooltipRoot :delay-duration="200">
                                    <TooltipTrigger as-child>
                                        <button class="p-1 border-l relative" :class="sectionMode.preprocess === 'json'
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-background text-muted-foreground hover:bg-accent'"
                                            @click.stop="sectionMode.preprocess = 'json'">
                                            <Braces class="w-3 h-3" />
                                            <!-- Dirty / error indicator dot -->
                                            <span v-if="preprocessEditorRef?.isDirty || preprocessEditorRef?.hasErrors"
                                                class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
                                                :class="preprocessEditorRef?.hasErrors ? 'bg-destructive' : 'bg-orange-400'"
                                            />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top"
                                        class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                        JSON
                                    </TooltipContent>
                                </TooltipRoot>
                            </div>
                        </div>
                    </div>
                    <div v-if="activeSection === 'preprocess'" class="mt-1 pl-3 border-l-2 border-muted space-y-1">
                        <template v-if="sectionMode.preprocess === 'visual'">
                            <StreamMatchPreprocessPanel :item="item" :stream-type="streamType"
                                :preprocess-active="preprocessActive" :preprocess-value="preprocessValue"
                                @set-field="(f, v) => emit('preprocess-set-field', f, v)" />
                        </template>
                        <template v-else>
                            <MonacoJsonEditor ref="preprocessEditorRef" :model-value="item.preprocess ?? {}"
                                @update:model-value="emit('handle-preprocess-json-change', $event)" />
                        </template>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped>
.item-name-group {
    position: relative;
}

.item-name-group:hover .rename-icon {
    opacity: 1;
}

.rename-icon {
    opacity: 0;
    transition: opacity 0.1s ease;
}
</style>