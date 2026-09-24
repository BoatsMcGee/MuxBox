<script setup lang="ts">
import { DialogRoot, DialogContent, DialogTitle, DialogClose } from 'reka-ui';
import UiButton from '@/components/ui/ui-button.vue';

defineOptions({ name: 'PresetSaveModal' });

interface Props {
    open: boolean;
    name: string;
    exists: boolean;
    error: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
    (e: 'confirm'): void;
    (e: 'cancel'): void;
    (e: 'update:name', value: string): void;
}>();
</script>

<template>
    <DialogRoot :open="props.open" @update:open="(v) => { if (!v) emit('cancel'); }">
        <DialogContent class="fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg gap-4 border bg-background p-6 shadow-lg sm:rounded-lg -translate-x-1/2 -translate-y-1/2">
            <DialogTitle class="text-sm font-semibold">Save As</DialogTitle>
            <div class="space-y-3" data-modal-container>
                <input :value="props.name"
                    class="w-full px-3 py-2 text-sm border rounded-md bg-background"
                    placeholder="Preset name..."
                    @input="emit('update:name', ($event.target as HTMLInputElement).value)"
                    @keyup.enter="emit('confirm')" />
                <div v-if="props.exists" class="text-[11px] text-amber-600 dark:text-amber-400">
                    A preset named "{{ props.name }}" already exists. Saving will overwrite it.
                </div>
                <div v-if="props.error" class="text-[11px] text-destructive">
                    {{ props.error }}
                </div>
                <div class="flex justify-end gap-2">
                    <UiButton variant="outline" size="sm" @click="emit('cancel')">
                        Cancel
                    </UiButton>
                    <UiButton size="sm" :disabled="!props.name.trim()" @click="emit('confirm')">
                        {{ props.exists ? 'Overwrite' : 'Save' }}
                    </UiButton>
                </div>
            </div>
            <DialogClose class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100">
                <span class="sr-only">Close</span>
            </DialogClose>
        </DialogContent>
    </DialogRoot>
</template>
