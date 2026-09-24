<script setup lang="ts">
import type { StreamItem, StreamType } from '@/components/source/types/stream-match-constants';

defineOptions({ name: 'StreamMatchPreprocessPanel' });

interface Props {
    item: StreamItem;
    streamType: StreamType;
    preprocessActive: boolean;
    preprocessValue: (field: string) => unknown;
}

defineProps<Props>();

const emit = defineEmits<{
    (e: 'set-field', field: string, value: unknown): void;
}>();
</script>

<template>
    <div class="space-y-2">
        <!-- Opusenc options -->
            <div v-if="streamType === 'audio'" class="space-y-2">
                <div class="flex items-center gap-2">
                    <label class="text-xs text-muted-foreground w-28 shrink-0">Bitrate</label>
                    <input type="number"
                        class="flex-1 px-2 py-1 text-xs border rounded-md bg-background"
                        placeholder="e.g. 128" :value="preprocessValue('bitrate')"
                        @input="emit('set-field', 'bitrate', ($event.target as HTMLInputElement).value === '' ? undefined : Number(($event.target as HTMLInputElement).value))" />
                </div>
                <div class="flex items-center gap-2">
                    <label class="text-xs text-muted-foreground w-28 shrink-0">Downmix</label>
                    <select class="flex-1 px-2 py-1 text-xs border rounded-md bg-background"
                        :value="preprocessValue('downmix')"
                        @change="emit('set-field', 'downmix', ($event.target as HTMLSelectElement).value || undefined)">
                        <option value="">— None —</option>
                        <option value="stereo">Stereo</option>
                        <option value="mono">Mono</option>
                    </select>
                </div>
                <div class="flex items-center gap-2">
                    <label class="text-xs text-muted-foreground w-28 shrink-0">Complexity</label>
                    <select class="flex-1 px-2 py-1 text-xs border rounded-md bg-background"
                        :value="preprocessValue('computationalComplexity')"
                        @change="emit('set-field', 'computationalComplexity', ($event.target as HTMLSelectElement).value === '' ? undefined : Number(($event.target as HTMLSelectElement).value))">
                        <option value="">— Default —</option>
                        <option v-for="n in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]" :key="n" :value="n">{{ n }}
                        </option>
                    </select>
                </div>
                <div class="flex items-center gap-2">
                    <label class="text-xs text-muted-foreground w-28 shrink-0">Frame Size (ms)</label>
                    <select class="flex-1 px-2 py-1 text-xs border rounded-md bg-background"
                        :value="preprocessValue('framesize')"
                        @change="emit('set-field', 'framesize', ($event.target as HTMLSelectElement).value === '' ? undefined : Number(($event.target as HTMLSelectElement).value))">
                        <option value="">— Default —</option>
                        <option :value="2.5">2.5</option>
                        <option :value="5">5</option>
                        <option :value="10">10</option>
                        <option :value="20">20</option>
                        <option :value="40">40</option>
                        <option :value="60">60</option>
                    </select>
                </div>
                <div class="flex items-center gap-2">
                    <label class="text-xs text-muted-foreground w-28 shrink-0">Volume Workaround</label>
                    <input type="checkbox" class="h-4 w-4 rounded border-input"
                        :checked="!!preprocessValue('volumeWorkaround')"
                        @change="emit('set-field', 'volumeWorkaround', ($event.target as HTMLInputElement).checked || undefined)" />
                </div>
                <div class="flex items-center gap-2">
                    <label class="text-xs text-muted-foreground w-28 shrink-0">Normalize</label>
                    <input type="checkbox" class="h-4 w-4 rounded border-input"
                        :checked="!!preprocessValue('normalize')"
                        @change="emit('set-field', 'normalize', ($event.target as HTMLInputElement).checked || undefined)" />
                </div>
            </div>
        </div>
</template>