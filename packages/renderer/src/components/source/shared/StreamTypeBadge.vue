<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '@/lib/utils';
import {
    STREAM_TYPES,
    STREAM_TYPE_INFO,
    getStreamTypeTooltip,
    type StreamType,
    type StreamTypeCounts,
    type StreamTypeBadgeVariant,
} from '@/lib/stream-types';
import { Video, Volume2, MessageSquareText, Paperclip, BookOpen } from '@lucide/vue';
import { TooltipRoot, TooltipTrigger, TooltipContent } from 'reka-ui';

interface Props {
    /**
     * Per-type stream counts.
     * - `matched` variant uses `count.matched`/`count.total` (N/M).
     * - `icon-badge` variant uses `count.total` for the corner badge.
     */
    counts: StreamTypeCounts;
    /** Visual variant. */
    variant?: StreamTypeBadgeVariant;
    /**
     * Optional click handler. When provided, badges become interactive:
     * clickable cursor, hover effects, and emit `click-type`.
     * When omitted, badges are purely informational.
     */
    onClickType?: (type: StreamType) => void;
    class?: string;
}

const props = withDefaults(defineProps<Props>(), {
    variant: 'icon-badge',
});

/** Icon component map — tree-shakeable static imports. */
const ICON_MAP: Record<StreamType, typeof Video | typeof Volume2 | typeof MessageSquareText | typeof Paperclip | typeof BookOpen> = {
    video: Video,
    audio: Volume2,
    subtitle: MessageSquareText,
    attachment: Paperclip,
    chapters: BookOpen,
};

/** Types with at least one stream — shown in both variants. */
const visibleTypes = computed(() =>
    STREAM_TYPES.filter(t => props.counts[t].total > 0),
);

/** True when every type has zero streams. */
const noStreams = computed(() =>
    visibleTypes.value.length === 0,
);

/** Whether badges should be interactive. */
const clickable = computed(() => props.onClickType != null);

function handleClick(type: StreamType) {
    if (props.onClickType) {
        props.onClickType(type);
    }
}
</script>

<template>
    <div :class="cn(
        'inline-flex items-center gap-1',
        props.class,
    )" role="group" :aria-label="variant === 'matched' ? 'Stream match summary' : 'Stream types'">
        <!-- ── Matched variant: coloured pills with N/M ────────────── -->
        <template v-if="variant === 'matched'">
            <!-- Empty state -->
            <span v-if="noStreams" class="text-xs text-muted-foreground italic">
                No streams
            </span>

            <template v-for="type in visibleTypes" :key="type">
                <TooltipRoot>
                    <TooltipTrigger as-child>
                        <component :is="clickable ? 'button' : 'span'" :class="[
                            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium',
                            STREAM_TYPE_INFO[type].color,
                            clickable
                                ? 'cursor-pointer hover:ring-2 transition-all'
                                : 'cursor-default',
                            clickable ? STREAM_TYPE_INFO[type].hoverRing : '',
                        ]" :aria-label="getStreamTypeTooltip(type, counts[type], variant)" @click.stop="handleClick(type)">
                            <component :is="ICON_MAP[type]" class="w-3.5 h-3.5 shrink-0" />
                            <!-- Chapters: show enabled/total (e.g. 3/5) or 0/N when disabled -->
                            <span v-if="type === 'chapters'" class="tabular-nums">{{ counts[type].chaptersEnabled ?
                                counts[type].total
                                : 0 }}/{{ counts[type].total }}</span>
                            <span v-else class="tabular-nums">{{ counts[type].matched }}/{{ counts[type].total }}</span>
                        </component>
                    </TooltipTrigger>
                    <TooltipContent side="top"
                        class="z-50 max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                        {{ getStreamTypeTooltip(type, counts[type], variant) }}
                    </TooltipContent>
                </TooltipRoot>
            </template>
        </template>

        <!-- ── Total variant: coloured pills showing just the total count (no N/M) ── -->
        <template v-else-if="variant === 'total'">
            <!-- Empty state -->
            <span v-if="noStreams" class="text-xs text-muted-foreground italic">
                No streams
            </span>

            <template v-for="type in visibleTypes" :key="type">
                <TooltipRoot>
                    <TooltipTrigger as-child>
                        <component :is="clickable ? 'button' : 'span'" :class="[
                            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium',
                            STREAM_TYPE_INFO[type].color,
                            clickable
                                ? 'cursor-pointer hover:ring-2 transition-all'
                                : 'cursor-default',
                            clickable ? STREAM_TYPE_INFO[type].hoverRing : '',
                        ]" :aria-label="getStreamTypeTooltip(type, counts[type], variant)" @click.stop="handleClick(type)">
                            <component :is="ICON_MAP[type]" class="w-3.5 h-3.5 shrink-0" />
                            <!-- Show just the total count -->
                            <span v-if="type === 'chapters'" class="tabular-nums">{{ counts[type].chaptersEnabled ? counts[type].total : 0 }}</span>
                            <span v-else class="tabular-nums">{{ counts[type].total }}</span>
                        </component>
                    </TooltipTrigger>
                    <TooltipContent side="top"
                        class="z-50 max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                        {{ getStreamTypeTooltip(type, counts[type], variant) }}
                    </TooltipContent>
                </TooltipRoot>
            </template>
        </template>

        <!-- ── Icon-badge variant: icon + corner count badge ───────── -->
        <template v-else-if="variant === 'icon-badge'">
            <template v-for="type in visibleTypes" :key="type">
                <TooltipRoot>
                    <TooltipTrigger as-child>
                        <component :is="clickable ? 'button' : 'span'" class="relative inline-flex shrink-0"
                            :class="clickable ? 'cursor-pointer hover:opacity-80 transition-opacity' : 'cursor-default'"
                            :aria-label="getStreamTypeTooltip(type, counts[type], variant)"
                            @click.stop="handleClick(type)">
                            <!-- Icon with type-specific stroke color -->
                            <component :is="ICON_MAP[type]" class="w-4 h-4" :class="STREAM_TYPE_INFO[type].textColor" />

                            <!-- Corner count badge — smaller, positioned top-right with minimal overlap -->
                            <span v-if="type !== 'chapters' && counts[type].total > 0" class="absolute -top-1 -right-1 flex items-center justify-center
                       min-w-[12px] h-[12px] px-[1px]
                       rounded-full bg-primary text-primary-foreground
                       text-[9px] font-semibold leading-none tabular-nums"
                                style="border: 1px solid hsl(var(--background));">
                                {{ counts[type].total }}
                            </span>

                            <!-- Chapters corner badge — show 0 when disabled, total when enabled -->
                            <span v-if="type === 'chapters' && counts[type].total > 0" class="absolute -top-1 -right-1 flex items-center justify-center
                       min-w-[12px] h-[12px] px-[1px]
                       rounded-full text-[9px] font-semibold leading-none tabular-nums" :class="counts[type].chaptersEnabled
                        ? 'bg-cyan-600 text-white dark:bg-cyan-400 dark:text-cyan-950'
                        : 'bg-gray-300 text-gray-600 dark:bg-gray-700 dark:text-gray-400'"
                                style="border: 1px solid hsl(var(--background));">
                                {{ counts[type].chaptersEnabled ? counts[type].total : 0 }}
                            </span>
                        </component>
                    </TooltipTrigger>
                    <TooltipContent side="top"
                        class="z-50 max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                        {{ getStreamTypeTooltip(type, counts[type], variant) }}
                    </TooltipContent>
                </TooltipRoot>
            </template>
        </template>

        <!-- ── Icon-only variant: bare colour-pill icon (non-interactive) ── -->
        <template v-else>
            <span v-for="type in visibleTypes" :key="type"
                class="inline-flex items-center justify-center w-5 h-5 rounded shrink-0"
                :class="STREAM_TYPE_INFO[type].color" :aria-label="STREAM_TYPE_INFO[type].ariaLabel">
                <component :is="ICON_MAP[type]" class="w-3 h-3" />
            </span>
        </template>
    </div>
</template>
