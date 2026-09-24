<script setup lang="ts">
import { computed, ref } from 'vue';
import { TooltipRoot, TooltipTrigger, TooltipContent } from 'reka-ui';
import { normalizeLanguage } from '@/lib/stream-match';
import { ChevronDown, ChevronUp } from '@lucide/vue';
import { formatBitrate, formatDuration } from '@/components/source/utils/format-media';

interface Props {
    tracks: Record<string, unknown> | null;
}

const props = defineProps<Props>();

interface StreamInfo {
    index: string;
    type: string;
    codec: string;
    language: string;
    title: string;
    details: Record<string, unknown>;
}

const streams = computed<StreamInfo[]>(() => {
    if (!props.tracks) return [];
    const result: StreamInfo[] = [];
    for (const [index, track] of Object.entries(props.tracks)) {
        if (!track || typeof track !== 'object') continue;
        const t = track as Record<string, unknown>;
        const type = (t['@type'] as string) ?? 'Unknown';
        if (type === 'Menu') continue;
        const codec = (t['Format'] as string) ?? (t['CodecID'] as string) ?? 'Unknown';
        const rawLanguage = normalizeLanguage(t) ?? t['Language'] as string;
        const language = rawLanguage ?? '—';
        const title = (t['Title'] as string) ?? '';
        result.push({ index, type, codec, language, title, details: t });
    }
    return result;
});

function getTypeIcon(type: string): string {
    switch (type) {
        case 'Video': return '🎬';
        case 'Audio': return '🔊';
        case 'Text': return '💬';
        default: return '📄';
    }
}

function getTypeColor(type: string): string {
    switch (type) {
        case 'Video': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
        case 'Audio': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
        case 'Text': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
        default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
    }
}

function getVideoDetails(d: Record<string, unknown>): { label: string; value: string }[] {
    return [
        { label: 'Resolution', value: `${d['Width'] ?? '?'}×${d['Height'] ?? '?'}` },
        { label: 'Aspect Ratio', value: String(d['DisplayAspectRatio'] ?? '—') },
        { label: 'Frame Rate', value: String(d['FrameRate'] ?? '—') },
        { label: 'Frame Count', value: String(d['FrameCount'] ?? '—') },
        { label: 'Frame Rate Mode', value: String(d['FrameRate_Mode'] ?? '—') },
        { label: 'Chroma Subsampling', value: String(d['ChromaSubsampling'] ?? '—') },
        { label: 'Bit Depth', value: String(d['BitDepth'] ?? '—') },
        { label: 'Scan Type', value: String(d['ScanType'] ?? '—') },
        { label: 'Bitrate', value: formatBitrate(d['BitRate']) },
        { label: 'Delay', value: String(d['Delay'] ?? '—') },
        { label: 'Duration', value: formatDuration(d['Duration']) },
        { label: 'Profile', value: String(d['Format_Profile'] ?? '—') },
        { label: 'Level', value: String(d['Format_Level'] ?? '—') },
        { label: 'Color Space', value: String(d['ColorSpace'] ?? '—') },
        { label: 'Default', value: String(d['Default'] ?? '—') },
        { label: 'Forced', value: String(d['Forced'] ?? '—') },
    ];
}

function getAudioDetails(d: Record<string, unknown>): { label: string; value: string }[] {
    return [
        { label: 'Channels', value: String(d['Channels'] ?? '—') },
        { label: 'Channel Layout', value: String(d['ChannelLayout'] ?? d['ChannelPositions'] ?? '—') },
        { label: 'Sample Rate', value: d['SamplingRate'] ? `${Number(d['SamplingRate']) / 1000} kHz` : '—' },
        { label: 'Bit Depth', value: String(d['BitDepth'] ?? '—') },
        { label: 'Bitrate', value: formatBitrate(d['BitRate']) },
        { label: 'Bitrate Mode', value: String(d['BitRate_Mode'] ?? '—') },
        { label: 'Compression', value: String(d['Compression_Mode'] ?? '—') },
        { label: 'Delay', value: String(d['Delay'] ?? '—') },
        { label: 'Duration', value: formatDuration(d['Duration']) },
        { label: 'Default', value: String(d['Default'] ?? '—') },
        { label: 'Forced', value: String(d['Forced'] ?? '—') },
    ];
}

function getSubtitleDetails(d: Record<string, unknown>): { label: string; value: string }[] {
    return [
        { label: 'Elements', value: String(d['ElementCount'] ?? '—') },
        { label: 'Frame Count', value: String(d['FrameCount'] ?? '—') },
        { label: 'Bitrate', value: formatBitrate(d['BitRate']) },
        { label: 'Compression', value: String(d['Compression_Mode'] ?? '—') },
        { label: 'Duration', value: formatDuration(d['Duration']) },
        { label: 'Default', value: String(d['Default'] ?? '—') },
        { label: 'Forced', value: String(d['Forced'] ?? '—') },
    ];
}

function getDetails(type: string, d: Record<string, unknown>): { label: string; value: string }[] {
    switch (type) {
        case 'Video': return getVideoDetails(d);
        case 'Audio': return getAudioDetails(d);
        case 'Text': return getSubtitleDetails(d);
        default: return Object.entries(d).map(([k, v]) => ({ label: k, value: String(v) }));
    }
}

const expandedIndex = ref<string | null>(null);

function toggleExpand(index: string) {
    expandedIndex.value = expandedIndex.value === index ? null : index;
}

function isExpanded(index: string): boolean {
    return expandedIndex.value === index;
}
</script>

<template>
    <div v-if="streams.length === 0" class="text-sm text-muted-foreground">
        Select a file to view MediaInfo
    </div>
    <div v-else class="space-y-2">
        <div
            v-for="stream in streams"
            :key="stream.index"
            class="rounded-lg border overflow-hidden"
        >
            <button
                class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                @click="toggleExpand(stream.index)"
            >
                <span class="text-sm">{{ getTypeIcon(stream.type) }}</span>
                <span class="text-xs font-mono text-muted-foreground">#{{ stream.index }}</span>
                <span
                    class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                    :class="getTypeColor(stream.type)"
                >
                    {{ stream.type }}
                </span>
                <span class="text-sm font-medium truncate">{{ stream.codec }}</span>
                <span v-if="stream.language !== '—'" class="text-xs text-muted-foreground">
                    ({{ stream.language }})
                </span>
                <span v-if="stream.title" class="text-xs text-muted-foreground truncate flex-1 text-right">
                    {{ stream.title }}
                </span>
                <span class="text-xs text-muted-foreground ml-1 inline-flex items-center">
                    <ChevronDown v-if="!isExpanded(stream.index)" class="w-3 h-3" />
                    <ChevronUp v-else class="w-3 h-3" />
                </span>
            </button>

            <div v-if="isExpanded(stream.index)" class="border-t px-3 py-2 bg-muted/30">
                <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div
                        v-for="detail in getDetails(stream.type, stream.details)"
                        :key="detail.label"
                        class="flex justify-between py-0.5"
                    >
                        <span class="text-muted-foreground">{{ detail.label }}</span>
                        <TooltipRoot :delay-duration="200">
                            <TooltipTrigger as-child>
                                <span class="font-mono truncate max-w-[60%] text-right cursor-help">
                                    {{ detail.value }}
                                </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                {{ detail.value }}
                            </TooltipContent>
                        </TooltipRoot>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
