<script setup lang="ts">
import { computed } from 'vue';
import { TooltipRoot, TooltipTrigger, TooltipContent, SwitchRoot, SwitchThumb, ComboboxRoot, ComboboxAnchor, ComboboxInput, ComboboxContent, ComboboxItem, ComboboxPortal, ComboboxViewport, ComboboxEmpty, DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from 'reka-ui';
import { getCodecSuggestions, getCodecLabel } from '@/lib/stream-match';
import UiButton from '@/components/ui/ui-button.vue';
import UiInputPrefix from '@/components/ui/ui-input-prefix.vue';
import { Plus, X } from '@lucide/vue';
import type { VisualRow, FieldDef, OperatorOption } from '@/components/source/types/stream-match-types';
import { DISPOSITION_OPTIONS } from '@/components/source/config/disposition-options';

const props = defineProps<{
    /** Absolute path of this row within the visual-row tree (root rows use a single-element array). */
    path: number[];
    row: VisualRow;
    field: string;
    fieldDefs: FieldDef[];
    operatorOptions: OperatorOption[];
    getAvailableOperators: (fieldValue: string) => OperatorOption[];
    isTerminalOp: (op: string) => boolean;
    isNestedOp: (op: string) => boolean;
    depth: number;
    /** Field values already used by sibling root rows — excluded from the field selector. */
    usedFields?: string[];
}>();

const emit = defineEmits<{
    (e: 'update-row-field', path: number[], field: string): void;
    (e: 'update-row-op', path: number[], op: string): void;
    (e: 'update-row-value', path: number[], value: string): void;
    (e: 'toggle-pattern-flag', path: number[], flag: string): void;
    (e: 'remove-row', path: number[]): void;
    (e: 'add-sub-row', path: number[]): void;
    (e: 'remove-sub-row', path: number[], subIndex: number): void;
    (e: 'add-disposition', path: number[], dispKey: string): void;
    (e: 'remove-disposition', path: number[], subIndex: number): void;
    (e: 'update-disposition-key', path: number[], subIndex: number, key: string): void;
    (e: 'update-disposition-value', path: number[], subIndex: number, value: boolean): void;
}>();

const patternFlagDefs = [
    { value: 'i', label: 'i', title: 'Case insensitive' },
    { value: 'g', label: 'g', title: 'Global' },
    { value: 'm', label: 'm', title: 'Multiline' },
];

// ─── Available field options (excluding already-used sibling fields) ──

const availableFieldDefs = computed(() => {
    if (!props.usedFields || props.depth > 0) return props.fieldDefs;
    return props.fieldDefs.filter(f => !props.usedFields!.includes(f.value) || f.value === props.row.field);
});

function subPath(subIndex: number): number[] {
    return [...props.path, subIndex];
}

function subCountLabel(rows: VisualRow[]): string {
    if (rows.length === 1) return '1 filter';
    return rows.length + ' filters';
}

// Get already used disposition keys from subRows
const usedDispositionKeys = computed(() =>
    props.row.subRows.map(sr => sr.field.split('.')[1]).filter(Boolean),
);

// Get available dispositions (not already used)
const availableDispositions = computed(() =>
    DISPOSITION_OPTIONS.filter(d => !usedDispositionKeys.value.includes(d.value)),
);

// Get disposition label from field name (e.g., "disposition.1" -> "Default")
function getDispositionLabel(field: string): string {
    const dispKey = field.split('.')[1];
    const dispOption = DISPOSITION_OPTIONS.find(d => d.value === dispKey);
    return dispOption ? dispOption.label : `Disposition ${dispKey}`;
}

// Check if this row is a disposition row (field === 'disposition')
const isDispositionRow = computed(() => props.row.field === 'disposition');

// Handle add disposition - pass the selected disposition key
function handleAddDisposition(dispKey: string) {
    emit('add-disposition', props.path, dispKey);
}

/** HTML input attributes for number-typed fields. */
function numberInputAttrs(field: string): Record<string, unknown> {
    switch (field) {
        case 'index': return { type: 'number', min: 0, step: 1 };
        case 'size': return { type: 'number', min: 0, step: 1 };
        case 'duration': return { type: 'number', min: 0, step: 0.001 };
        case 'width': return { type: 'number', min: 1, step: 1 };
        case 'height': return { type: 'number', min: 1, step: 1 };
        case 'bitrate': return { type: 'number', min: 0, step: 1 };
        case 'channels': return { type: 'number', min: 1, step: 1 };
        default: return {};
    }
}

/** Whether the field should show a unit suffix after its input. */
function numberFieldSuffix(field: string): string | undefined {
    switch (field) {
        case 'duration': return 's';
        case 'size': return 'bits';
        case 'width':
        case 'height': return 'px';
        case 'bitrate': return 'bits/s';
        default: return undefined;
    }
}
</script>

<template>
    <div class="border rounded-md p-2 space-y-1">
        <div class="flex items-center gap-2">
            <!-- Field select (only editable at root rows; nested rows inherit the field) -->
            <template v-if="depth > 0">
                <!-- Ghost field: inherited from parent, show as text -->
                <span class="text-sm text-muted-foreground font-medium shrink-0">
                    {{ fieldDefs.find((f: FieldDef) => f.value === row.field)?.label ?? row.field }}
                </span>
            </template>
            <select v-else
                :value="row.field"
                class="w-auto min-w-0 px-2 py-1.5 text-sm border rounded-md bg-background"
                @change="emit('update-row-field', path, ($event.target as HTMLSelectElement).value)"
            >
                <option v-for="f in availableFieldDefs" :key="f.value" :value="f.value">
                    {{ f.label }}
                </option>
            </select>

            <!-- Operator select (hidden for disposition rows) -->
            <template v-if="!isDispositionRow">
                <select
                    :value="row.operator"
                    class="w-auto min-w-0 px-2 py-1.5 text-sm border rounded-md bg-background"
                    @change="emit('update-row-op', path, ($event.target as HTMLSelectElement).value)"
                >
                    <option v-for="op in getAvailableOperators(row.field)" :key="op.value" :value="op.value">
                        {{ op.label }}
                    </option>
                </select>
            </template>

            <!-- Value area -->
            <template v-if="isTerminalOp(row.operator) && !isDispositionRow">
                <!-- Pattern field with /regex/ prefix/suffix -->
                <template v-if="row.operator === 'pattern'">
                    <UiInputPrefix
                        :model-value="row.value"
                        placeholder="regex..."
                        mono
                        class="flex-1 min-w-0"
                        @update:model-value="emit('update-row-value', path, $event)"
                    >
                        <template #prefix>
                            <span class="text-sm text-muted-foreground font-mono pl-2 pr-0.5 select-none">/</span>
                        </template>
                        <template #suffix>
                            <span class="text-sm text-muted-foreground font-mono pl-0.5 pr-0.5 select-none">/</span>
                            <div class="flex gap-0.5 pr-1.5">
                                <button
                                    v-for="flag in patternFlagDefs"
                                    :key="flag.value"
                                    class="px-1 py-0.5 text-xs font-mono border rounded transition-colors"
                                    :class="row.patternFlags.includes(flag.value)
                                        ? 'bg-primary text-primary-foreground border-primary'
                                        : 'bg-background text-muted-foreground hover:bg-accent border-input'"
                                    :title="flag.title"
                                    @click="emit('toggle-pattern-flag', path, flag.value)"
                                >
                                    {{ flag.label }}
                                </button>
                            </div>
                        </template>
                    </UiInputPrefix>
                </template>
                <!-- Codec: searchable Combobox with numeric AVCodecID values -->
                <template v-else-if="row.field === 'codec'">
                    <ComboboxRoot
                        :model-value="row.value"
                        @update:model-value="(v: string) => emit('update-row-value', path, v)"
                        :open-on-focus="true"
                        :open-on-click="true"
                        class="flex-1 min-w-0"
                    >
                        <ComboboxAnchor class="w-full flex items-center rounded-md border border-input bg-background overflow-hidden">
                            <ComboboxInput
                                :display-value="(val: any) => {
                                    if (!val) return '';
                                    const n = Number(val);
                                    if (!Number.isNaN(n)) return getCodecLabel(n);
                                    return String(val);
                                }"
                                class="w-full px-2 py-1.5 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground/50 font-mono"
                                placeholder="Type to search codec..."
                            />
                        </ComboboxAnchor>
                        <ComboboxPortal>
                            <ComboboxContent
                                position="popper"
                                class="z-50 rounded-md border bg-popover text-popover-foreground shadow-md"
                                :side-offset="4"
                            >
                                <ComboboxViewport class="max-h-60">
                                    <ComboboxItem
                                        v-for="s in getCodecSuggestions()"
                                        :key="s.value"
                                        :value="s.value"
                                        :text-value="s.label"
                                        class="px-3 py-1.5 text-sm cursor-pointer outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=checked]:bg-accent/50"
                                    >
                                        {{ s.label }}
                                    </ComboboxItem>
                                    <ComboboxEmpty class="px-3 py-1.5 text-sm text-muted-foreground">
                                        No codec found
                                    </ComboboxEmpty>
                                </ComboboxViewport>
                            </ComboboxContent>
                        </ComboboxPortal>
                    </ComboboxRoot>
                </template>
                <!-- Normal fields -->
                <template v-else>
                    <div class="flex-1 min-w-0 relative">
                        <input
                            v-bind="numberInputAttrs(row.field)"
                            :value="row.value"
                            class="w-full px-2 py-1.5 text-sm border rounded-md bg-background"
                            :class="numberFieldSuffix(row.field) ? 'pr-8' : ''"
                            placeholder="Value..."
                            @input="emit('update-row-value', path, ($event.target as HTMLInputElement).value)"
                        />
                        <span v-if="numberFieldSuffix(row.field)"
                            class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono pointer-events-none select-none"
                        >
                            {{ numberFieldSuffix(row.field) }}
                        </span>
                    </div>
                </template>
            </template>
            <template v-else-if="(isNestedOp(row.operator) && row.operator !== 'not') || isDispositionRow">
                <!-- For nested ops and disposition: show sub-rule count or nothing (hidden for 'not' since it always has exactly 1) -->
                <span class="flex-1 px-2 py-1.5 text-sm text-muted-foreground italic min-w-0">
                    {{ subCountLabel(row.subRows) }}
                </span>
            </template>
<TooltipRoot :delay-duration="200">
    <TooltipTrigger as-child>
        <UiButton
            variant="ghost"
            size="icon-sm"
            class="text-muted-foreground hover:text-destructive shrink-0"
            @click="emit('remove-row', path)"
        >
            <X class="w-3 h-3" />
        </UiButton>
    </TooltipTrigger>
    <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
        Remove filter
    </TooltipContent>
</TooltipRoot>
        </div>

        <!-- Recursively nested sub-rules (for not/allOf/anyOf/oneOf) -->
        <div v-if="isNestedOp(row.operator) && !isDispositionRow" class="ml-6 pl-3 border-l-2 border-muted space-y-1">
            <StreamMatchRow
                v-for="(sr, srIdx) in row.subRows"
                :key="srIdx"
                :path="subPath(srIdx)"
                :row="sr"
                :field="row.field"
                :field-defs="fieldDefs"
                :operator-options="operatorOptions"
                :get-available-operators="getAvailableOperators"
                :is-terminal-op="isTerminalOp"
                :is-nested-op="isNestedOp"
                :depth="depth + 1"
                @update-row-field="(p, f) => emit('update-row-field', p, f)"
                @update-row-op="(p, o) => emit('update-row-op', p, o)"
                @update-row-value="(p, v) => emit('update-row-value', p, v)"
                @toggle-pattern-flag="(p, fl) => emit('toggle-pattern-flag', p, fl)"
                @remove-row="(p) => emit('remove-row', p)"
                @add-sub-row="(p) => emit('add-sub-row', p)"
                @remove-sub-row="(p, i) => emit('remove-sub-row', p, i)"
            />
            <!-- Add filter skeleton (hidden for 'not' operator which must have exactly one sub-rule) -->
            <div
                v-if="row.operator !== 'not'"
                class="flex items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-md py-1.5 cursor-pointer hover:border-primary hover:bg-accent/20 transition-colors group"
                @click="emit('add-sub-row', path)"
            >
                <div class="flex items-center gap-1.5 text-muted-foreground/60 group-hover:text-foreground transition-colors">
                    <Plus class="w-3.5 h-3.5" />
                    <span class="text-[11px]">Add filter</span>
                </div>
            </div>
        </div>

        <!-- Disposition sub-rows: compact grid with label above switch -->
        <div v-if="isDispositionRow" class="ml-6 pl-3 border-l-2 border-muted space-y-1">
            <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1.5 p-2">
                <!-- Disposition items -->
                <div v-for="(sr, srIdx) in row.subRows" :key="srIdx" class="flex flex-col items-center gap-0.5 p-1 bg-background/50 rounded-md">
                    <!-- Disposition label on top -->
                    <span class="text-[10px] font-medium truncate leading-tight max-w-full">{{ getDispositionLabel(sr.field) }}</span>
                    
                    <!-- Switch + remove button -->
                    <div class="flex items-center gap-0.5">
                        <SwitchRoot
                            :key="`${sr.field}-${sr.value}`"
                            :model-value="sr.value === 'true'"
                            class="inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=checked]:bg-primary data-[state=unchecked]:bg-input h-4 w-7"
                            @update:model-value="(v: boolean) => emit('update-disposition-value', path, srIdx, v)"
                        >
                            <SwitchThumb class="pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-transform h-3 w-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0" />
                        </SwitchRoot>
                        <TooltipRoot :delay-duration="200">
                            <TooltipTrigger as-child>
                                <button class="text-muted-foreground hover:text-destructive p-0.5 rounded shrink-0"
                                    @click="emit('remove-disposition', path, srIdx)">
                                    <X class="w-2.5 h-2.5" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                Remove disposition
                            </TooltipContent>
                        </TooltipRoot>
                    </div>
                </div>
                
                <!-- Add new disposition (skeleton row) -->
                <div v-if="availableDispositions.length > 0" class="flex items-center justify-center">
                    <DropdownMenuRoot>
                        <DropdownMenuTrigger as-child>
                            <button
                                class="flex items-center justify-center w-6 h-6 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
                            >
                                <Plus class="w-3.5 h-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="bottom" align="start" :side-offset="2"
                            class="z-50 min-w-32 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
                            <DropdownMenuItem v-for="d in availableDispositions" :key="d.value"
                                class="text-xs px-2 py-1.5 rounded cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors"
                                @click="handleAddDisposition(d.value)">
                                {{ d.label }}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenuRoot>
                </div>
                
                <!-- Empty state -->
                <div v-if="row.subRows.length === 0 && availableDispositions.length === 0" class="col-span-full flex items-center justify-center py-2 text-xs text-muted-foreground">
                    All dispositions configured
                </div>
            </div>
        </div>
    </div>
</template>
