<script setup lang="ts">

import { ref, watch, computed } from 'vue';
import { TooltipRoot, TooltipTrigger, TooltipContent } from 'reka-ui';
import { CheckboxRoot, CheckboxIndicator } from 'reka-ui';
import { Check } from '@lucide/vue';
import { FIELD_CLASS_MAP, FIELD_HEX_MAP } from '@/lib/template-colors';
import { TEMPLATE_FIELDS } from '@/lib/template-fields';
import type { FieldConfig } from '@/lib/template-fields';
import sanitize from 'sanitize-filename';

const props = defineProps<{
    open: boolean;
    template: string;
    fieldConfig?: Record<string, FieldConfig>;
    seriesName?: string;
}>();

const emit = defineEmits<{
    (e: 'open'): void;
    (e: 'close'): void;
    (e: 'save', template: string, fieldConfig: Record<string, FieldConfig>): void;
}>();

interface FieldEntry {
    tag: string;
    name: string;
}

const BASE_FIELD_ENTRIES: FieldEntry[] = [
    { tag: '{{SERIES_NAME}}', name: 'Series Name' },
    { tag: '{{SEASON_NUMBER}}', name: 'Season Number' },
    { tag: '{{EPISODE_NUMBER}}', name: 'Episode Number' },
    { tag: '{{EPISODE_NAME}}', name: 'Episode Name' },
    { tag: '{{VIDEO_CODEC}}', name: 'Video Codec' },
    { tag: '{{AUDIO_CODEC}}', name: 'Audio Codec' },
    { tag: '{{VIDEO_HEIGHT}}', name: 'Video Height' },
    { tag: '{{DUAL_AUDIO}}', name: 'Dual Audio' },
];

const PREFIX_SUGGESTIONS = ['[', '{', '(', '.', ',', '#', '$', '@', '-', '_', '<', '!', '%', '|', ':'];
const SUFFIX_SUGGESTIONS = [']', '}', ')', '.', ',', '-', '_', '>', '!', '%', '|', ':', '?'];

const FIELD_ENTRIES = computed(() => BASE_FIELD_ENTRIES.map(f => {
    let desc: string;
    switch (f.tag) {
        case '{{SERIES_NAME}}':
            desc = props.seriesName || 'Series name';
            break;
        case '{{VIDEO_CODEC}}':
            desc = 'e.g. AVC, HEVC, AV1';
            break;
        case '{{AUDIO_CODEC}}':
            desc = 'e.g. FLAC, AAC, AC3';
            break;
        case '{{VIDEO_HEIGHT}}':
            desc = 'e.g. 1080p, 720p';
            break;
        case '{{DUAL_AUDIO}}':
            desc = '"Dual Audio" for 2 languages, "Multi Audio" for more';
            break;
        default:
            desc = '';
            break;
    }
    return { ...f, description: desc, color: FIELD_CLASS_MAP[f.tag] ?? '' };
}));

const templateInput = ref(props.template);
const templateDivRef = ref<HTMLDivElement | null>(null);
const isUpdatingContent = ref(false);

/** Render the template string into HTML with colored field tokens. */
function renderHighlightedTemplate(text: string): string {
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    // Replace {{...}} tokens with colored spans using FIELD_HEX_MAP
    return escaped.replace(/\{\{[A-Z_]+\}\}/g, (match) => {
        const hex = FIELD_HEX_MAP[match] ?? '#0891b2';
        return `<span style="color:${hex}; font-weight:500">${match}</span>`;
    });
}

function syncContentEditableToTemplate() {
    const div = templateDivRef.value;
    if (!div) return;
    isUpdatingContent.value = true;
    div.innerHTML = renderHighlightedTemplate(templateInput.value);
    // Place cursor at end
    const range = document.createRange();
    range.selectNodeContents(div);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
    }
    isUpdatingContent.value = false;
}

function onTemplateInput() {
    if (isUpdatingContent.value) return;
    const div = templateDivRef.value;
    if (!div) return;
    // Extract plain text from contenteditable div (strips HTML markup)
    templateInput.value = div.innerText || div.textContent || '';
}

const localFieldConfig = ref<Record<string, FieldConfig>>(
    props.fieldConfig ? JSON.parse(JSON.stringify(props.fieldConfig)) : {},
);

const prefixOpen = ref<string | null>(null);
const suffixOpen = ref<string | null>(null);

function togglePrefix(tag: string) {
    prefixOpen.value = prefixOpen.value === tag ? null : tag;
    suffixOpen.value = null;
}

function toggleSuffix(tag: string) {
    suffixOpen.value = suffixOpen.value === tag ? null : tag;
    prefixOpen.value = null;
}

function selectPrefixSuggestion(tag: string, char: string) {
    const cfg = getFieldConfig(tag);
    cfg.prefix = char;
    prefixOpen.value = null;
}

function selectSuffixSuggestion(tag: string, char: string) {
    const cfg = getFieldConfig(tag);
    cfg.suffix = char;
    suffixOpen.value = null;
}

function onPrefixBlur(tag: string) {
    window.setTimeout(() => { if (prefixOpen.value === tag) prefixOpen.value = null; }, 150);
}

function onSuffixBlur(tag: string) {
    window.setTimeout(() => { if (suffixOpen.value === tag) suffixOpen.value = null; }, 150);
}

function getFieldConfig(tag: string): FieldConfig {
    if (!localFieldConfig.value[tag]) {
        localFieldConfig.value[tag] = { prefix: '', suffix: '', alwaysAdd: false };
    }
    return localFieldConfig.value[tag]!;
}

watch(() => props.open, (isOpen) => {
    if (isOpen) {
        templateInput.value = props.template;
        localFieldConfig.value = props.fieldConfig
            ? JSON.parse(JSON.stringify(props.fieldConfig))
            : {};
        requestAnimationFrame(() => syncContentEditableToTemplate());
    }
}, { immediate: true });

function insertTag(tag: string) {
    const div = templateDivRef.value;
    if (!div) {
        templateInput.value += tag;
        return;
    }
    // Insert at cursor position in contenteditable
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && div.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        const textNode = document.createTextNode(tag);
        range.deleteContents();
        range.insertNode(textNode);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    } else {
        // Fallback: append
        const textNode = document.createTextNode(tag);
        div.appendChild(textNode);
    }
    // Sync plain text back
    templateInput.value = div.innerText || div.textContent || '';
    // Re-render highlights
    syncContentEditableToTemplate();
}

function save() {
    emit('save', templateInput.value, { ...localFieldConfig.value });
}

// ─── Example Preview ──────────────────────────────────────────

interface Preset {
    label: string;
    seriesName: string;
    seasonNumber: number;
    episodeNumber: number;
    episodeName: string;
    videoCodec: string;
    audioCodec: string;
    videoHeight: string;
    dualAudio: string;
}

const PRESETS: Preset[] = [
    { label: 'The Grand Tour', seriesName: 'The Grand Tour (2016)', seasonNumber: 5, episodeNumber: 1, episodeName: 'A Scandi Flick', videoCodec: 'AV1', audioCodec: 'OPUS', videoHeight: '2160p', dualAudio: 'Dual Audio' },
    { label: 'Star Trek', seriesName: 'Star Trek', seasonNumber: 2, episodeNumber: 15, episodeName: 'The Trouble with Tribbles', videoCodec: 'AVC', audioCodec: 'AC3', videoHeight: '480p', dualAudio: '' },
    { label: 'Squid Game', seriesName: 'Squid Game', seasonNumber: 1, episodeNumber: 4, episodeName: 'Stick to the Team', videoCodec: 'HEVC', audioCodec: 'AAC', videoHeight: '1080p', dualAudio: 'Multi Audio' },
];

const selectedPreset = ref(0);

function resolveFieldPreview(tag: string, value: string): string {
    const cfg = getFieldConfig(tag);
    if (value || cfg.alwaysAdd) {
        return `${cfg.prefix}${value}${cfg.suffix}`;
    }
    return '';
}

const preview = computed(() => {
    const preset = PRESETS[selectedPreset.value]!;
    const seasonPad = getFieldConfig(TEMPLATE_FIELDS.SEASON_NUMBER).padding ?? 2;
    const episodePad = getFieldConfig(TEMPLATE_FIELDS.EPISODE_NUMBER).padding ?? 2;
    const fields: [string, string][] = [
        [TEMPLATE_FIELDS.SERIES_NAME, sanitize(preset.seriesName)],
        [TEMPLATE_FIELDS.SEASON_NUMBER, resolveFieldPreview(TEMPLATE_FIELDS.SEASON_NUMBER, String(preset.seasonNumber).padStart(seasonPad, '0'))],
        [TEMPLATE_FIELDS.EPISODE_NUMBER, resolveFieldPreview(TEMPLATE_FIELDS.EPISODE_NUMBER, String(preset.episodeNumber).padStart(episodePad, '0'))],
        [TEMPLATE_FIELDS.EPISODE_NAME, preset.episodeName ? sanitize(preset.episodeName) : ''],
        [TEMPLATE_FIELDS.VIDEO_CODEC, resolveFieldPreview(TEMPLATE_FIELDS.VIDEO_CODEC, preset.videoCodec)],
        [TEMPLATE_FIELDS.AUDIO_CODEC, resolveFieldPreview(TEMPLATE_FIELDS.AUDIO_CODEC, preset.audioCodec)],
        [TEMPLATE_FIELDS.VIDEO_HEIGHT, resolveFieldPreview(TEMPLATE_FIELDS.VIDEO_HEIGHT, preset.videoHeight)],
        [TEMPLATE_FIELDS.DUAL_AUDIO, resolveFieldPreview(TEMPLATE_FIELDS.DUAL_AUDIO, preset.dualAudio)],
    ];
    let result = templateInput.value;
    for (const [tag, val] of fields) {
        result = result.replace(tag, val);
    }
    // Strip unfilled tokens
    result = result.replace(/\s*\{\{[A-Z_]+\}\}\s*/g, ' ').trim();
    result = result.replace(/\s{2,}/g, ' ');
    return result || '(empty)';
});
</script>

<template>
    <!-- View mode: same display, not editable -->
    <div v-if="!props.open" class="flex items-center gap-2">
        <div class="flex-1 min-w-0 overflow-x-auto scrollbar-none">
            <div class="text-sm font-mono whitespace-nowrap"
                v-html="renderHighlightedTemplate(props.template || '{{SERIES_NAME}} - {{SEASON_NUMBER}}{{EPISODE_NUMBER}} - {{EPISODE_NAME}}')">
            </div>
        </div>
        <button type="button"
            class="h-9 px-4 text-xs border rounded-md hover:bg-accent shrink-0"
            @click="emit('open')">
            Edit
        </button>
    </div>
    <!-- Edit mode: interactive contenteditable + field config -->
    <div v-else class="space-y-3">
            <!-- Template input -->
            <div>
                <div
                    ref="templateDivRef"
                    contenteditable="plaintext-only"
                    class="contenteditable-placeholder w-full min-h-[2.25rem] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring whitespace-pre-wrap break-all cursor-text"
                    :data-placeholder="'e.g. {{SERIES_NAME}} - {{SEASON_NUMBER}}{{EPISODE_NUMBER}} - {{EPISODE_NAME}}'"
                    @input="onTemplateInput"
                    @blur="onTemplateInput"
                ></div>
            </div>

            <!-- Example Preview -->
        <div class="rounded-md bg-muted/30 px-3 py-2 border">
            <div class="text-xs text-muted-foreground mb-1.5">Example Preview</div>
            <div class="flex flex-wrap items-center gap-1.5 mb-2">
                <button
                    v-for="(p, i) in PRESETS"
                    :key="i"
                    type="button"
                    class="rounded px-2 py-0.5 text-xs font-medium border transition-colors"
                    :class="selectedPreset === i ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background hover:bg-accent'"
                    @click="selectedPreset = i"
                >{{ p.label }}</button>
            </div>
            <div class="text-sm font-mono truncate rounded bg-muted px-2.5 py-1.5 border border-border min-h-[1.75rem]">
                {{ preview }}
            </div>
        </div>

        <!-- Fields list: responsive grid, equal-width cards -->
        <div class="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-3 items-start content-start">
            <div
                v-for="field in FIELD_ENTRIES"
                :key="field.tag"
                class="rounded-md border border-border bg-card p-3"
            >
                <div class="flex items-start justify-between gap-2">
                    <!-- Left: name + description -->
                    <div class="min-w-0 flex-1">
                        <TooltipRoot :delay-duration="300">
                            <TooltipTrigger as-child>
                                <button
                                    type="button"
                                    :class="['text-sm font-medium text-left cursor-pointer hover:underline focus:outline-none focus:underline transition-colors', field.color]"
                                    @click="insertTag(field.tag)"
                                >
                                    {{ field.name }}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
                                Click to append {{ field.tag }} to template
                            </TooltipContent>
                        </TooltipRoot>
                        <p class="text-[11px] text-muted-foreground mt-0.5 leading-tight">{{ field.description }}</p>
                    </div>

                    <!-- Right: padding (numeric fields), prefix, suffix, always-add -->
                    <div class="flex items-start gap-2 shrink-0">
                        <!-- Padding input for Season/Episode -->
                        <div v-if="field.tag === '{{SEASON_NUMBER}}' || field.tag === '{{EPISODE_NUMBER}}'" class="flex flex-col gap-0.5 w-14">
                            <label class="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Padding</label>
                            <input
                                type="number"
                                :value="getFieldConfig(field.tag).padding ?? 2"
                                @input="(e) => { const cfg = getFieldConfig(field.tag); cfg.padding = Math.max(1, Math.min(10, parseInt((e.target as HTMLInputElement).value) || 2)); }"
                                min="1"
                                max="10"
                                class="w-14 rounded border border-input bg-background px-1.5 py-1 text-xs font-mono outline-none focus:ring-1 focus:ring-ring"
                            />
                        </div>
                        <div class="flex flex-col gap-0.5">
                            <label class="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Prefix</label>
                            <div class="relative">
                                <input
                                    type="text"
                                    :value="getFieldConfig(field.tag).prefix"
                                    @input="(e) => { const cfg = getFieldConfig(field.tag); cfg.prefix = (e.target as HTMLInputElement).value; }"
                                    @focus="togglePrefix(field.tag)"
                                    @blur="onPrefixBlur(field.tag)"
                                    class="w-16 rounded border border-input bg-background px-1.5 py-1 text-xs font-mono outline-none focus:ring-1 focus:ring-ring"
                                    placeholder=""
                                />
                                <div
                                    v-if="prefixOpen === field.tag"
                                    class="absolute top-full left-0 z-50 mt-0.5 w-48 max-h-32 overflow-y-auto rounded border border-border bg-popover p-1 shadow-md grid grid-cols-5 gap-0.5"
                                >
                                    <button
                                        v-for="ch in PREFIX_SUGGESTIONS"
                                        :key="ch"
                                        type="button"
                                        class="inline-flex items-center justify-center w-7 h-7 rounded text-xs font-mono hover:bg-accent transition-colors"
                                        @mousedown.prevent="selectPrefixSuggestion(field.tag, ch)"
                                    >
                                        {{ ch }}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="flex flex-col gap-0.5">
                            <label class="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Suffix</label>
                            <div class="relative">
                                <input
                                    type="text"
                                    :value="getFieldConfig(field.tag).suffix"
                                    @input="(e) => { const cfg = getFieldConfig(field.tag); cfg.suffix = (e.target as HTMLInputElement).value; }"
                                    @focus="toggleSuffix(field.tag)"
                                    @blur="onSuffixBlur(field.tag)"
                                    class="w-16 rounded border border-input bg-background px-1.5 py-1 text-xs font-mono outline-none focus:ring-1 focus:ring-ring"
                                    placeholder=""
                                />
                                <div
                                    v-if="suffixOpen === field.tag"
                                    class="absolute top-full right-0 z-50 mt-0.5 w-48 max-h-32 overflow-y-auto rounded border border-border bg-popover p-1 shadow-md grid grid-cols-5 gap-0.5"
                                >
                                    <button
                                        v-for="ch in SUFFIX_SUGGESTIONS"
                                        :key="ch"
                                        type="button"
                                        class="inline-flex items-center justify-center w-7 h-7 rounded text-xs font-mono hover:bg-accent transition-colors"
                                        @mousedown.prevent="selectSuffixSuggestion(field.tag, ch)"
                                    >
                                        {{ ch }}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="flex flex-col gap-0.5 items-center">
                            <label class="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Always</label>
                            <TooltipRoot :delay-duration="200">
                                <TooltipTrigger as-child>
                                    <button type="button" class="focus:outline-none" @click="() => { const cfg = getFieldConfig(field.tag); cfg.alwaysAdd = !cfg.alwaysAdd; }">
                                        <CheckboxRoot
                                            :checked="getFieldConfig(field.tag).alwaysAdd"
                                            class="inline-flex items-center justify-center w-4 h-4 rounded-[3px] border shrink-0 transition-colors data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground data-[state=unchecked]:border-input"
                                        >
                                            <CheckboxIndicator>
                                                <Check class="w-3 h-3" stroke-width="3" />
                                            </CheckboxIndicator>
                                        </CheckboxRoot>
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" class="z-50 rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md max-w-[200px]">
                                    Prefix and Suffix will be added even if the value is none/empty
                                </TooltipContent>
                            </TooltipRoot>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Footer buttons -->
        <div class="flex items-center justify-end gap-2">
            <button
                class="inline-flex items-center justify-center rounded-md text-xs font-medium border border-input bg-background hover:bg-accent h-8 px-3"
                @click="emit('close')"
            >
                Cancel
            </button>
            <button
                class="inline-flex items-center justify-center rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3"
                @click="save"
            >
                Apply
            </button>
        </div>
    </div>
</template>

<style scoped>
.contenteditable-placeholder:empty:before {
    content: attr(data-placeholder);
    color: #9ca3af;
    pointer-events: none;
}
</style>
