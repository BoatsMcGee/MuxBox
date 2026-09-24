<script setup lang="ts">
import { X, Plus } from '@lucide/vue';
import UiButton from '@/components/ui/ui-button.vue';
import { SwitchRoot, SwitchThumb, TooltipRoot, TooltipTrigger, TooltipContent, DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from 'reka-ui';
import type { StreamItem, DispositionOption, TagEntry, StreamType } from '@/components/source/types/stream-match-constants';
import { DISPOSITION_OPTIONS } from '@/components/source/config/disposition-options';
import { computed } from 'vue';

defineOptions({ name: 'StreamMatchModifyPanel' });

interface Props {
    item: StreamItem;
    streamType: StreamType;
    activeDispositionLabels: DispositionOption[];
    tagEntries: TagEntry[];
    modifyCount: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
    (e: 'set-field', field: string, value: unknown): void;
    (e: 'set-tag', key: string, value: string): void;
    (e: 'add-tag'): void;
    (e: 'remove-tag', key: string): void;
    (e: 'rename-tag', oldKey: string, newKey: string, tagIdx: number): void;
    (e: 'toggle-disposition', dispKey: string): void;
    (e: 'remove-disposition', dispKey: string): void;
    (e: 'update-disposition-value', dispKey: string, value: boolean): void;
}>();

// Get the current disposition object from item.modify
const dispositionObj = computed(() => (props.item.modify?.disposition as Record<string, unknown> | undefined) ?? {});

// Get active dispositions as array of { key, selector } for display
const activeDispositions = computed(() => {
    const obj = dispositionObj.value;
    return Object.entries(obj).map(([key, selector]) => ({
        key,
        label: DISPOSITION_OPTIONS.find(d => d.value === key)?.label ?? `Disposition ${key}`,
        value: getValueFromSelector(selector),
    }));
});

// Extract boolean value from selector
// Handles both plain booleans (legacy DispositionState format) and selector objects (new format)
function getValueFromSelector(selector: unknown): boolean {
    if (typeof selector === 'boolean') return selector;
    if (typeof selector !== 'object' || selector === null) return true;
    const sel = selector as Record<string, unknown>;
    if ('equal' in sel) return sel.equal === true;
    if ('not' in sel) {
        const inner = sel.not as Record<string, unknown>;
        if ('equal' in inner) return inner.equal !== true; // not equal to true = false
    }
    return true;
}

// Get available dispositions (not already used)
const availableDispositions = computed(() => {
    const usedKeys = new Set(activeDispositions.value.map(d => d.key));
    return DISPOSITION_OPTIONS.filter(d => !usedKeys.has(d.value));
});

// Handle adding a new disposition
function addDisposition(dispKey: string) {
    emit('toggle-disposition', dispKey);
}

// Handle removing a disposition
function removeDisposition(dispKey: string) {
    emit('remove-disposition', dispKey);
}

// Handle switch change - only boolean value (no operator dropdown needed)
function onValueChange(dispKey: string, value: boolean) {
    emit('update-disposition-value', dispKey, value);
}
</script>

<template>
    <div class="space-y-2">
        <!-- Language -->
            <div class="flex items-center gap-2">
                <label class="text-xs text-muted-foreground w-20 shrink-0">Language</label>
                <div class="flex-1 relative">
                    <input class="w-full px-2 py-1 text-xs border rounded-md bg-background pr-6"
                        placeholder="e.g. en-US, jpn..."
                        :value="(item.modify?.language as string) ?? ''"
                        @input="emit('set-field', 'language', ($event.target as HTMLInputElement).value)" />
                    <TooltipRoot v-if="'language' in (item.modify ?? {})" :delay-duration="200">
                        <TooltipTrigger as-child>
                            <button
                                class="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-destructive"
                                @click="emit('set-field', 'language', undefined)">
                                <X class="w-3 h-3" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                            Reset (remove modification)
                        </TooltipContent>
                    </TooltipRoot>
                </div>
            </div>
            <!-- Title -->
            <div class="flex items-center gap-2">
                <label class="text-xs text-muted-foreground w-20 shrink-0">Title</label>
                <div class="flex-1 relative">
                    <input class="w-full px-2 py-1 text-xs border rounded-md bg-background pr-6"
                        placeholder="e.g. English Dub" :value="(item.modify?.title as string) ?? ''"
                        @input="emit('set-field', 'title', ($event.target as HTMLInputElement).value)" />
                    <TooltipRoot v-if="'title' in (item.modify ?? {})" :delay-duration="200">
                        <TooltipTrigger as-child>
                            <button
                                class="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-destructive"
                                @click="emit('set-field', 'title', undefined)">
                                <X class="w-3 h-3" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                            Reset (remove modification)
                        </TooltipContent>
                    </TooltipRoot>
                </div>
            </div>
            <!-- Disposition: grid layout -->
            <div class="space-y-1">
                <span class="text-xs text-muted-foreground">Disposition</span>
                
                <div v-if="activeDispositions.length === 0 && availableDispositions.length === 0" class="text-xs text-muted-foreground">
                    No dispositions configured
                </div>
                
                <div v-if="activeDispositions.length > 0 || availableDispositions.length > 0" class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1.5 p-2">
                    <!-- Active disposition items -->
                    <div v-for="d in activeDispositions" :key="d.key" class="flex flex-col items-center gap-0.5 p-1 bg-background/50 rounded-md">
                        <span class="text-[10px] font-medium truncate leading-tight max-w-full">{{ d.label }}</span>
                        <div class="flex items-center gap-0.5">
                            <SwitchRoot
                                :key="`${d.key}-${d.value}`"
                                :model-value="d.value"
                                class="inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=checked]:bg-primary data-[state=unchecked]:bg-input h-4 w-7"
                                @update:model-value="(v: boolean) => onValueChange(d.key, v)"
                            >
                                <SwitchThumb class="pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-transform h-3 w-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0" />
                            </SwitchRoot>
                            <TooltipRoot :delay-duration="200">
                                <TooltipTrigger as-child>
                                    <button class="text-muted-foreground hover:text-destructive p-0.5 rounded shrink-0"
                                        @click="removeDisposition(d.key)">
                                        <X class="w-2.5 h-2.5" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                    Remove disposition
                                </TooltipContent>
                            </TooltipRoot>
                        </div>
                    </div>
                    
                    <!-- Add new disposition skeleton -->
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
                                    @click="addDisposition(d.value)">
                                    {{ d.label }}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenuRoot>
                    </div>
                </div>
            </div>
            <div v-if="streamType === 'audio' || streamType === 'subtitle'"
                class="flex items-center gap-2">
                <label class="text-xs text-muted-foreground w-20 shrink-0">Delay (ms)</label>
                <input type="number"
                    class="flex-1 px-2 py-1 text-xs border rounded-md bg-background"
                    placeholder="e.g. 150" :value="(item.modify?.delay as number | undefined) ?? ''"
                    @input="emit('set-field', 'delay', ($event.target as HTMLInputElement).value === '' ? undefined : Number(($event.target as HTMLInputElement).value))" />
            </div>
            <!-- Tags -->
            <div class="space-y-1">
                <div class="flex items-center justify-between">
                    <label class="text-xs text-muted-foreground">Tags</label>
                    <button
                        class="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
                        @click="emit('add-tag')">
                        <Plus class="w-2.5 h-2.5" />
                        Add tag
                    </button>
                </div>
                <div v-for="(tag, tagIdx) in tagEntries" :key="tag.key"
                    class="flex items-center gap-1">
                    <input
                        class="flex-1 px-2 py-1 text-xs border rounded-md bg-background font-mono"
                        placeholder="Key" :value="tag.key"
                        @change="emit('rename-tag', tag.key, ($event.target as HTMLInputElement).value, tagIdx)" />
                    <span class="text-xs text-muted-foreground">=</span>
                    <input
                        class="flex-[2] px-2 py-1 text-xs border rounded-md bg-background font-mono"
                        placeholder="Value" :value="tag.value"
                        @input="emit('set-tag', tag.key, ($event.target as HTMLInputElement).value)" />
                    <TooltipRoot :delay-duration="200">
                        <TooltipTrigger as-child>
                            <UiButton variant="ghost" size="icon-sm"
                                class="text-muted-foreground hover:text-destructive shrink-0"
                                @click="emit('remove-tag', tag.key)">
                                <X class="w-3 h-3" />
                            </UiButton>
                        </TooltipTrigger>
                        <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                            Remove tag
                        </TooltipContent>
                    </TooltipRoot>
                </div>
            </div>
        </div>
</template>