<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { Search, Pencil, Save, Trash2, Plus } from '@lucide/vue';
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui';
import { TooltipRoot, TooltipTrigger, TooltipContent } from 'reka-ui';
import UiHoverActions from '@/components/ui/ui-hover-actions.vue';

defineOptions({ name: 'PresetManagerPopover' });

interface PresetItem {
    name: string;
    streamType: string;
    modifiedAt: string;
}

interface Props {
    presets: PresetItem[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
    (e: 'add-new'): void;
    (e: 'apply-preset', name: string): void;
    (e: 'rename-preset', oldName: string, newName: string): void;
    (e: 'delete-preset', name: string): void;
}>();

// ─── Popover open state ──────────────────────────────────────

const open = ref(false);

// ─── Search state ────────────────────────────────────────────

const searchQuery = ref('');

const filteredPresets = computed(() => {
    const q = searchQuery.value.toLowerCase().trim();
    if (!q) return props.presets;
    return props.presets.filter((p) => p.name.toLowerCase().includes(q));
});

// ─── Inline rename state ─────────────────────────────────────

const renamingName = ref<string | null>(null);
const renameValue = ref('');

function startRename(name: string) {
    renamingName.value = name;
    renameValue.value = name;
    nextTick(() => {
        const input = document.querySelector<HTMLInputElement>('.rename-input');
        input?.focus();
        input?.select();
    });
}

function commitRename(oldName: string) {
    const trimmed = renameValue.value.trim();
    if (!trimmed || trimmed === oldName) {
        cancelRename();
        return;
    }
    emit('rename-preset', oldName, trimmed);
    renamingName.value = null;
}

function cancelRename() {
    renamingName.value = null;
    renameValue.value = '';
}

// ─── Actions that close the popover ──────────────────────────

function handleAddNew() {
    emit('add-new');
    open.value = false;
}
</script>

<template>
    <PopoverRoot v-model:open="open">
        <PopoverTrigger as-child>
            <slot>
                <button
                    class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
                >
                    <Plus class="w-3.5 h-3.5" />
                    Add Preset
                </button>
            </slot>
        </PopoverTrigger>
        <PopoverPortal>
            <PopoverContent side="bottom" align="end" :side-offset="4"
                class="z-50 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md outline-none"
                :style="{ width: 'var(--reka-popper-anchor-width)' }">
                <div class="space-y-3">
                    <!-- Search bar -->
                    <div class="relative">
                        <Search class="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                        <input v-model="searchQuery" placeholder="Search presets..."
                            class="w-full pl-7 pr-3 py-1.5 text-xs border rounded-md bg-background placeholder:text-muted-foreground/50" />
                    </div>

                    <!-- New Configuration button -->
                    <button
                        class="w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded text-left hover:bg-accent hover:text-accent-foreground transition-colors"
                        @click="handleAddNew">
                        <Plus class="w-3.5 h-3.5" />
                        New Configuration
                    </button>

                    <div class="h-px bg-border" />

                    <!-- Preset list (scrollable) -->
                    <div class="max-h-72 overflow-y-auto space-y-0.5 -mx-1 px-1">
                        <div v-for="preset in filteredPresets" :key="preset.name"
                            class="group flex items-center justify-between px-3 py-1.5 text-xs rounded cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors"
                            @click="emit('apply-preset', preset.name)">

                            <!-- Rename input (visible when renaming this preset) -->
                            <template v-if="renamingName === preset.name">
                                <input v-model="renameValue"
                                    class="rename-input flex-1 px-2 py-0.5 text-xs border rounded bg-background min-w-0 mr-1"
                                    @click.stop
                                    @keyup.enter="commitRename(preset.name)"
                                    @keyup.escape="cancelRename" />
                                <UiHoverActions>
                                    <TooltipRoot :delay-duration="200">
                                        <TooltipTrigger as-child>
                                            <button @click.stop="commitRename(preset.name)"
                                                class="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-accent"
                                            >
                                                <Save class="w-3 h-3" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                            Save
                                        </TooltipContent>
                                    </TooltipRoot>
                                </UiHoverActions>
                            </template>

                            <!-- Display mode (default) -->
                            <template v-else>
                                <span class="truncate">{{ preset.name }}</span>
                                <UiHoverActions>
                                    <TooltipRoot :delay-duration="200">
                                        <TooltipTrigger as-child>
                                            <button @click.stop="startRename(preset.name)"
                                                class="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-accent"
                                            >
                                                <Pencil class="w-3 h-3" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                            Rename
                                        </TooltipContent>
                                    </TooltipRoot>
                                    <TooltipRoot :delay-duration="200">
                                        <TooltipTrigger as-child>
                                            <button @click.stop="emit('delete-preset', preset.name)"
                                                class="text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded hover:bg-accent"
                                            >
                                                <Trash2 class="w-3 h-3" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                            Delete
                                        </TooltipContent>
                                    </TooltipRoot>
                                </UiHoverActions>
                            </template>
                        </div>

                        <!-- Empty states -->
                        <div v-if="props.presets.length === 0"
                            class="px-3 py-4 text-xs text-center text-muted-foreground">
                            No saved presets
                        </div>
                        <div v-else-if="filteredPresets.length === 0"
                            class="px-3 py-4 text-xs text-center text-muted-foreground">
                            No presets match "{{ searchQuery }}"
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </PopoverPortal>
    </PopoverRoot>
</template>
