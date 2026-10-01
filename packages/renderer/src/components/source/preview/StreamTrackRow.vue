<script setup lang="ts">
import { computed } from 'vue';
import { Check, X, ChevronDown, ChevronUp, Pencil, Plus, Video, Volume2, MessageSquareText, Paperclip } from '@lucide/vue';
import UiBadgedIcon from '@/components/ui/ui-badged-icon.vue';
import { TooltipRoot, TooltipTrigger, TooltipContent } from 'reka-ui';
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui';
import { SwitchRoot, SwitchThumb, DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from 'reka-ui';
import type { MatchedTrack } from '@/lib/stream-match';
import { STREAM_TYPE_INFO } from '@/lib/stream-types';
import type { StreamType } from '@/lib/stream-types';
import {
    getStreamDetails,
    getTrackHeaderValues,
    hasModifications,
    isTrackExcluded,
    activeDispositions,
    activeDispositionsRaw,
    availableDispositions,
    activeTags,
    activeTagsRaw,
    computeNewTag,
    getTrackModifier,
    type DetailRow,
} from '@/components/source/composables/useStreamMatchPreview';

defineOptions({ name: 'StreamTrackRow' });

interface Props {
    track: MatchedTrack;
    file: string;
    expanded: boolean;
    excludedTracksByFile?: Record<string, Set<number>>;
    perTrackModifiersByFile?: Record<string, Record<number, Record<string, unknown>>>;
    getTrackDetails?: (track: MatchedTrack, file: string, trackIdx: number) => DetailRow[];
}

const props = withDefaults(defineProps<Props>(), {
    excludedTracksByFile: () => ({}),
    perTrackModifiersByFile: () => ({}),
});

const emit = defineEmits<{
    (e: 'toggle-expand', file: string, trackIdx: number): void;
    (e: 'toggle-exclude', file: string, trackIdx: number): void;
    (e: 'update:perTrackModifier', file: string, trackIdx: number, field: string, val: unknown): void;
    (e: 'clearPerTrackModifier', file: string, trackIdx: number, field: string): void;
    (e: 'open-raw-dialog', file: string, data: unknown, trackIndex: number | undefined): void;
}>();

const excluded = computed(() => isTrackExcluded(props.file, props.track.index, props.excludedTracksByFile));
const hasMods = computed(() => hasModifications(props.track));
const details = computed(() =>
    getStreamDetails(
        props.track.streamInfo,
        props.track.modify as Record<string, unknown> | undefined,
        props.track.preprocess as Record<string, unknown> | undefined,
        props.file,
        props.track.index,
        props.perTrackModifiersByFile ?? {},
    ),
);
const typeInfo = computed(() => (STREAM_TYPE_INFO[props.track.type as StreamType] ?? STREAM_TYPE_INFO.video));
const headerValues = computed(() =>
    getTrackHeaderValues(props.track, props.file, props.perTrackModifiersByFile),
);
const truncatedState: Record<string, boolean> = {};

function onHoverTruncated(e: MouseEvent, key: string) {
    if (!(key in truncatedState)) {
        const el = e.currentTarget as HTMLElement;
        truncatedState[key] = el.scrollWidth > el.clientWidth;
    }
}

// Per-track modifier helpers bound to this file/track context
const trackDisp = () => activeDispositions(props.perTrackModifiersByFile, props.file, props.track.index);
const trackAvailDisp = () => availableDispositions(props.perTrackModifiersByFile, props.file, props.track.index);
const trackDispRaw = () => activeDispositionsRaw(props.perTrackModifiersByFile, props.file, props.track.index);
const trackTags = () => activeTags(props.perTrackModifiersByFile, props.file, props.track.index);
const trackTagsRaw = () => activeTagsRaw(props.perTrackModifiersByFile, props.file, props.track.index);

/**
 * Effective zlib compression for this track: per-track override wins, then the
 * match-item `modify.compress`, then the `true` default the muxer applies.
 * Used to seed the override switch when no explicit override is set.
 */
function effectiveCompress(): boolean {
    const ovr = getTrackModifier(props.perTrackModifiersByFile, props.file, props.track.index, 'compress');
    if (typeof ovr === 'boolean') return ovr;
    return true;
}

function addTagLocal() {
    const newTags = computeNewTag(props.perTrackModifiersByFile, props.file, props.track.index);
    emit('update:perTrackModifier', props.file, props.track.index, 'tags', newTags);
}
</script>

<template>
    <div>
        <!-- Stream row (clickable to expand details) -->
        <button
            :data-stream-type="track.type"
            :data-stream-index="track.index"
            class="w-full flex items-center gap-2 px-3 py-1.5 border-b last:border-b-0 text-xs text-left hover:bg-muted/30 transition-colors"
            :class="{ 'opacity-40': !track.matched }"
            @click="emit('toggle-expand', file, track.index)">
            <!-- Match indicator badge (clickable, toggles exclusion) -->
            <TooltipRoot>
                <TooltipTrigger as-child>
                    <span role="button" tabindex="0"
                        class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
                        :class="excluded ? 'text-destructive' : track.matched ? 'text-green-600 dark:text-green-400' : 'text-destructive'"
                        @click.stop="emit('toggle-exclude', file, track.index)">
                        <UiBadgedIcon v-if="excluded && hasMods" position="bottom-right">
                            <span>🛇</span>
                            <template #subicon>
                                <Pencil class="w-2 h-2 text-yellow-600 dark:text-yellow-400" />
                            </template>
                        </UiBadgedIcon>
                        <span v-else-if="excluded">🛇</span>
                        <UiBadgedIcon v-else-if="track.matched && hasMods" position="bottom-right">
                            <Check class="w-3.5 h-3.5" />
                            <template #subicon>
                                <Pencil class="w-2 h-2 text-yellow-600 dark:text-yellow-400" />
                            </template>
                        </UiBadgedIcon>
                        <span v-else-if="track.matched"><Check class="w-3.5 h-3.5" /></span>
                        <span v-else><X class="w-3.5 h-3.5" /></span>
                    </span>
                </TooltipTrigger>
                <TooltipContent side="right" class="z-50 max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                    {{ excluded ? 'Track excluded, click to include' : track.matched ? 'Click to exclude this track' : 'Track not matched' }}
                </TooltipContent>
            </TooltipRoot>
            <span class="font-mono text-muted-foreground w-6 text-right tabular-nums shrink-0">#{{ track.index }}</span>
            <!-- Combined type icon + codec badge -->
            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium font-mono shrink-0"
                :class="typeInfo.color">
                <Video v-if="track.type === 'video'" class="w-3 h-3 shrink-0" />
                <Volume2 v-else-if="track.type === 'audio'" class="w-3 h-3 shrink-0" />
                <MessageSquareText v-else-if="track.type === 'subtitle'" class="w-3 h-3 shrink-0" />
                <Paperclip v-else class="w-3 h-3 shrink-0" />
                <span :class="headerValues.codecChanged ? 'text-yellow-700 dark:text-yellow-300 font-medium' : ''">{{ headerValues.codec }}</span>
            </span>
            <span v-if="track.type === 'attachment' && track.streamInfo.metadata?.filename"
                class="text-muted-foreground truncate max-w-[200px]"
                @mouseenter="onHoverTruncated($event, `${track.index}-filename`)">
                <TooltipRoot v-if="truncatedState[`${track.index}-filename`]">
                    <TooltipTrigger as-child>
                        <span class="truncate max-w-full cursor-help">({{ track.streamInfo.metadata.filename }})</span>
                    </TooltipTrigger>
                    <TooltipContent side="right" class="z-50 max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                        {{ track.streamInfo.metadata.filename }}
                    </TooltipContent>
                </TooltipRoot>
                <span v-else class="truncate">({{ track.streamInfo.metadata.filename }})</span>
            </span>
            <span v-if="headerValues.language"
                :class="headerValues.languageChanged ? 'text-yellow-700 dark:text-yellow-300 font-medium' : 'text-muted-foreground'">
                <TooltipRoot v-if="track.streamInfo.extra?.Language_String || track.streamInfo.extra?.language_ietf || track.streamInfo.extra?.language">
                    <TooltipTrigger as-child>
                        <span class="cursor-help">{{ headerValues.language }}</span>
                    </TooltipTrigger>
                    <TooltipContent side="right" class="z-50 max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                        {{ String(track.streamInfo.extra.Language_String ?? track.streamInfo.extra.language_ietf ?? track.streamInfo.extra.language ?? headerValues.language) }}
                    </TooltipContent>
                </TooltipRoot>
                <span v-else>{{ headerValues.language }}</span>
            </span>
            <span v-if="headerValues.title" class="truncate max-w-[200px]"
                :class="headerValues.titleChanged ? 'text-yellow-700 dark:text-yellow-300 font-medium' : 'text-muted-foreground'"
                @mouseenter="onHoverTruncated($event, `${track.index}-title`)">
                <TooltipRoot v-if="truncatedState[`${track.index}-title`]">
                    <TooltipTrigger as-child>
                        <span class="truncate max-w-full cursor-help">{{ headerValues.title }}</span>
                    </TooltipTrigger>
                    <TooltipContent side="right" class="z-50 max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                        {{ headerValues.title }}
                    </TooltipContent>
                </TooltipRoot>
                <span v-else class="truncate">{{ headerValues.title }}</span>
            </span>

            <span class="flex-1"></span>
            <span class="text-xs text-muted-foreground inline-flex items-center">
                <ChevronDown v-if="!expanded" class="w-3 h-3" />
                <ChevronUp v-else class="w-3 h-3" />
            </span>
        </button>

        <!-- Expanded track details -->
        <div v-if="expanded" class="border-b bg-muted/30 px-4 py-2">
            <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <template v-for="detail in details" :key="detail.label">
                    <div class="flex justify-between py-0.5 items-start gap-1"
                        :class="detail.changed ? 'border-l-2 border-yellow-500/50 pl-2 -ml-2' : ''">
                        <span class="text-muted-foreground">{{ detail.label }}</span>
                        <span class="flex items-center gap-1 max-w-[65%] justify-end">
                            <!-- Changed value display -->
                            <template v-if="detail.changed">
                                <template v-if="detail.dispItems">
                                    <span class="flex flex-wrap gap-x-1 justify-end">
                                        <span v-for="(item, di) in detail.dispItems" :key="di" :class="[
                                            'font-mono text-xs',
                                            item.status === 'added' ? 'text-yellow-700 dark:text-yellow-300 font-medium' : '',
                                            item.status === 'removed' ? 'text-red-700 dark:text-red-300 line-through' : '',
                                            item.status === 'kept' ? 'text-foreground' : '',
                                        ]">{{ item.label }}</span>
                                    </span>
                                </template>
                                <template v-else-if="detail.after">
                                    <span class="font-mono truncate text-right flex items-center gap-1 justify-end">
                                        <span v-if="detail.before" class="text-muted-foreground line-through">{{ detail.before }}</span>
                                        <span v-if="detail.before" class="text-yellow-700 dark:text-yellow-300 font-medium">→</span>
                                        <span :class="detail.overridden ? 'font-bold text-yellow-800 dark:text-yellow-200' : 'text-yellow-800 dark:text-yellow-200 font-medium'">{{ detail.after }}</span>
                                    </span>
                                </template>
                            </template>
                            <!-- Unchanged value display -->
                            <template v-else>
                                <span class="font-mono truncate text-right"
                                    :class="detail.overridden ? 'font-bold' : ''"
                                    :title="detail.value">{{ detail.value }}</span>
                            </template>
                            <!-- Override edit button -->
                            <template v-if="track.type !== 'attachment' && detail.overridable">
                                <PopoverRoot>
                                    <PopoverTrigger as-child>
                                        <button class="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted/50" title="Edit override">
                                            <Pencil class="w-2.5 h-2.5" />
                                        </button>
                                    </PopoverTrigger>
                                    <PopoverPortal>
                                        <PopoverContent side="left" align="start" :side-offset="4"
                                            class="z-50 rounded-lg border bg-popover p-2.5 text-popover-foreground shadow-md outline-none w-56">
                                            <!-- Title override -->
                                            <template v-if="detail.overrideField === 'title'">
                                                <div class="space-y-1.5">
                                                    <label class="text-xs font-medium">Title Override</label>
                                                    <div class="relative">
                                                        <input class="w-full px-2 py-1 text-xs border rounded bg-background font-mono pr-6"
                                                            :placeholder="track.title || '—'"
                                                            :value="(detail.overrideValue as string) ?? ''"
                                                            @input="emit('update:perTrackModifier', file, track.index, 'title', ($event.target as HTMLInputElement).value || undefined)" />
                                                        <button v-if="detail.overridden"
                                                            class="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive"
                                                            @click="emit('clearPerTrackModifier', file, track.index, 'title')">
                                                            <X class="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                    <button v-if="detail.overridden"
                                                        class="text-[10px] text-muted-foreground hover:text-destructive underline"
                                                        @click="emit('clearPerTrackModifier', file, track.index, 'title')">
                                                        Clear override
                                                    </button>
                                                </div>
                                            </template>
                                            <!-- Language override -->
                                            <template v-else-if="detail.overrideField === 'language'">
                                                <div class="space-y-1.5">
                                                    <label class="text-xs font-medium">Language Override</label>
                                                    <div class="relative">
                                                        <input class="w-full px-2 py-1 text-xs border rounded bg-background font-mono pr-6"
                                                            :placeholder="track.language === '—' ? '' : track.language"
                                                            :value="(detail.overrideValue as string) ?? ''"
                                                            @input="emit('update:perTrackModifier', file, track.index, 'language', ($event.target as HTMLInputElement).value || undefined)" />
                                                        <button v-if="detail.overridden"
                                                            class="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive"
                                                            @click="emit('clearPerTrackModifier', file, track.index, 'language')">
                                                            <X class="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                    <button v-if="detail.overridden"
                                                        class="text-[10px] text-muted-foreground hover:text-destructive underline"
                                                        @click="emit('clearPerTrackModifier', file, track.index, 'language')">
                                                        Clear override
                                                    </button>
                                                </div>
                                            </template>
                                            <!-- Delay override -->
                                            <template v-else-if="detail.overrideField === 'delay'">
                                                <div class="space-y-1.5">
                                                    <label class="text-xs font-medium">Delay Override (ms)</label>
                                                    <div class="relative">
                                                        <input type="number" class="w-full px-2 py-1 text-xs border rounded bg-background font-mono pr-6"
                                                            placeholder="0"
                                                            :value="(detail.overrideValue as number) ?? ''"
                                                            @input="emit('update:perTrackModifier', file, track.index, 'delay', ($event.target as HTMLInputElement).value === '' ? undefined : Number(($event.target as HTMLInputElement).value))" />
                                                        <button v-if="detail.overridden"
                                                            class="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive"
                                                            @click="emit('clearPerTrackModifier', file, track.index, 'delay')">
                                                            <X class="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                    <button v-if="detail.overridden"
                                                        class="text-[10px] text-muted-foreground hover:text-destructive underline"
                                                        @click="emit('clearPerTrackModifier', file, track.index, 'delay')">
                                                        Clear override
                                                    </button>
                                                </div>
                                            </template>
                                            <!-- zlib compression override -->
                                            <template v-else-if="detail.overrideField === 'compress'">
                                                <div class="space-y-1.5">
                                                    <label class="text-xs font-medium">zlib Compression</label>
                                                    <div class="flex items-center gap-2">
                                                        <SwitchRoot
                                                            :model-value="(detail.overrideValue as boolean | undefined) ?? effectiveCompress()"
                                                            class="inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input h-4 w-7"
                                                            @update:model-value="(v: boolean) => emit('update:perTrackModifier', file, track.index, 'compress', v)">
                                                            <SwitchThumb class="pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-transform h-3 w-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0" />
                                                        </SwitchRoot>
                                                        <span class="text-[10px] text-muted-foreground">
                                                            {{ ((detail.overrideValue as boolean | undefined) ?? effectiveCompress()) ? 'On' : 'Off' }}
                                                        </span>
                                                    </div>
                                                    <p class="text-[10px] text-muted-foreground">Compress this track's text subtitles with zlib.</p>
                                                    <button v-if="detail.overridden"
                                                        class="text-[10px] text-muted-foreground hover:text-destructive underline"
                                                        @click="emit('clearPerTrackModifier', file, track.index, 'compress')">
                                                        Clear override
                                                    </button>
                                                </div>
                                            </template>
                                            <!-- Disposition override -->
                                            <template v-else-if="detail.overrideField === 'disposition'">
                                                <div class="space-y-1.5">
                                                    <label class="text-xs font-medium">Disposition Override</label>
                                                    <div class="flex flex-wrap gap-1">
                                                        <template v-if="trackDisp().length > 0">
                                                            <div v-for="d in trackDisp()" :key="d.key"
                                                                class="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-background/60 border text-[10px]">
                                                                <SwitchRoot
                                                                    :model-value="d.value"
                                                                    class="inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input h-3 w-5"
                                                                    @update:model-value="(v: boolean) => {
                                                                        const cur = trackDispRaw();
                                                                        emit('update:perTrackModifier', file, track.index, 'disposition', v ? { ...cur, [d.key]: true } : { ...cur, [d.key]: false });
                                                                    }">
                                                                    <SwitchThumb class="pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-transform h-2 w-2 data-[state=checked]:translate-x-2 data-[state=unchecked]:translate-x-0" />
                                                                </SwitchRoot>
                                                                <span>{{ d.label }}</span>
                                                                <button class="text-muted-foreground hover:text-destructive"
                                                                    @click="{
                                                                        const cur = trackDispRaw();
                                                                        delete cur[d.key];
                                                                        emit('update:perTrackModifier', file, track.index, 'disposition', Object.keys(cur).length > 0 ? cur : undefined);
                                                                    }">
                                                                    <X class="w-2 h-2" />
                                                                </button>
                                                            </div>
                                                        </template>
                                                        <span v-if="trackDisp().length === 0" class="text-[10px] text-muted-foreground">No overrides set</span>
                                                    </div>
                                                    <div class="flex items-center gap-1 mt-1">
                                                        <DropdownMenuRoot>
                                                            <DropdownMenuTrigger as-child>
                                                                <button
                                                                    class="flex items-center justify-center w-5 h-5 rounded border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
                                                                >
                                                                    <Plus class="w-3 h-3" />
                                                                </button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent side="bottom" align="start" :side-offset="2"
                                                                class="z-50 min-w-28 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
                                                                <DropdownMenuItem v-for="d in trackAvailDisp()" :key="d.value"
                                                                    class="text-[10px] px-2 py-1.5 rounded cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors"
                                                                    @click="{
                                                                        const cur = trackDispRaw();
                                                                        cur[d.value] = true;
                                                                        emit('update:perTrackModifier', file, track.index, 'disposition', cur);
                                                                    }">
                                                                    {{ d.label }}
                                                                </DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenuRoot>
                                                    </div>
                                                    <button v-if="detail.overridden"
                                                        class="text-[10px] text-muted-foreground hover:text-destructive underline"
                                                        @click="emit('clearPerTrackModifier', file, track.index, 'disposition')">
                                                        Clear all overrides
                                                    </button>
                                                </div>
                                            </template>
                                            <!-- Tags override -->
                                            <template v-else-if="detail.overrideField === 'tags'">
                                                <div class="space-y-1.5">
                                                    <label class="text-xs font-medium">Tags Override</label>
                                                    <div class="flex flex-wrap gap-1">
                                                        <template v-if="trackTags().length > 0">
                                                            <div v-for="t in trackTags()" :key="t.key"
                                                                class="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-background/60 border text-[10px] font-mono">
                                                                <span>{{ t.key }}={{ t.value }}</span>
                                                                <button class="text-muted-foreground hover:text-destructive"
                                                                    @click="{
                                                                        const cur = trackTagsRaw();
                                                                        delete cur[t.key];
                                                                        emit('update:perTrackModifier', file, track.index, 'tags', Object.keys(cur).length > 0 ? cur : undefined);
                                                                    }">
                                                                    <X class="w-2 h-2" />
                                                                </button>
                                                            </div>
                                                        </template>
                                                        <span v-if="trackTags().length === 0" class="text-[10px] text-muted-foreground">No overrides set</span>
                                                    </div>
                                                    <button class="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
                                                        @click="addTagLocal()">
                                                        <Plus class="w-2.5 h-2.5" />
                                                        Add tag
                                                    </button>
                                                    <button v-if="detail.overridden"
                                                        class="text-[10px] text-muted-foreground hover:text-destructive underline block mt-1"
                                                        @click="emit('clearPerTrackModifier', file, track.index, 'tags')">
                                                        Clear all overrides
                                                    </button>
                                                </div>
                                            </template>
                                        </PopoverContent>
                                    </PopoverPortal>
                                </PopoverRoot>
                            </template>
                        </span>
                    </div>
                </template>
                <div class="col-span-2 mt-2 pt-2 border-t">
                    <button class="text-xs text-primary hover:underline"
                        @click.stop="emit('open-raw-dialog', file, {
                            streamInfo: [track.streamInfo],
                            mediaInfoExtra: track.streamInfo.extra ? [{ index: track.streamInfo.index, codec: track.streamInfo.codecName, ...track.streamInfo.extra }] : [],
                        }, track.index)">
                        Raw Stream Info
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
