<script setup lang="ts">
import { computed, ref, nextTick } from 'vue';
import { Plus, X, Undo2, Volume2, MessageSquareText, Paperclip, Video } from '@lucide/vue';
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent, SwitchRoot, SwitchThumb } from 'reka-ui';
import { STREAM_TYPE_INFO } from '@/lib/stream-types';
import { useEpisodeQueueStore } from '@/stores/useEpisodeQueueStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { ProjectData } from '@app/preload';
import type { TrackConfigItem } from './EpisodeQueueItem.vue';

defineOptions({ name: 'EpisodeTrackRow' });

interface Props {
    track: TrackConfigItem;
    episodeId: string;
    sourceFile: string;
    trackProgress?: { packetsWritten: number; percent: number; packetsPerSecond: number };
    expanded: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
    (e: 'toggle-expand', trackIndex: number): void;
    (e: 'update-track', trackIndex: number, field: 'title' | 'language', value: string | undefined): void;
    (e: 'update-track-disposition', trackIndex: number, dispKey: number, enabled: boolean): void;
    (e: 'update-track-delay', trackIndex: number, delayMs: number): void;
}>();

const queueStore = useEpisodeQueueStore();
const projectStore = useProjectStore();
const episodeProgress = computed(() => queueStore.getProgress(props.episodeId));
/** Whether THIS specific episode is currently muxing — guards metadata edits. */
const isThisEpisodeMuxing = computed(() =>
    episodeProgress.value.status === 'preprocessing' || episodeProgress.value.status === 'muxing',
);

// ─── Project data override helpers ──────────────────────────

/**
 * Write a track override to the project's queueTrackOverrides.
 * Uses the stable key format "demuxerMapKey:originalIndex".
 * Since we don't have the demuxerMapKey at this layer, we use the
 * episodeId as the stable key prefix. The caller (preload) reconstructs
 * the full key when applying overrides during muxing.
 *
 * This is the single choke point for track-level edits (title, language,
 * delay, dispositions, tags, mime, filename), so it is also where the
 * episode's completion is invalidated — the muxed output no longer matches
 * the configured track.
 */
function updateTrackOverride(field: string, value: string | undefined, disposition?: number | undefined): void {
    if (!props.episodeId || isThisEpisodeMuxing.value) return;

    const stableKey = `${props.track.demuxerMapKey}:${props.track.fileStreamIndex}`;

    projectStore.updateProject((d: ProjectData) => {
        if (!d.queueTrackOverrides) d.queueTrackOverrides = {};
        if (!d.queueTrackOverrides[props.episodeId]) d.queueTrackOverrides[props.episodeId] = {};
        if (!d.queueTrackOverrides[props.episodeId][stableKey]) d.queueTrackOverrides[props.episodeId][stableKey] = {};

        const entry = d.queueTrackOverrides[props.episodeId][stableKey];

        if (field === 'title' || field === 'language') {
            if (value === undefined || value === '') {
                delete entry[field];
            } else {
                (entry as Record<string, string>)[field] = value;
            }
        } else if (field === 'tags' && value) {
            // value is JSON string of tags
            const tags = JSON.parse(value) as Record<string, string>;
            entry.tags = { ...(entry.tags ?? {}), ...tags };
        } else if (field === 'disposition' && disposition !== undefined && value !== undefined) {
            // value is "true" or "false"
            const enabled = value === 'true';
            if (!entry.disposition) entry.disposition = {};
            if (enabled) {
                entry.disposition[String(disposition)] = true;
            } else {
                delete entry.disposition[String(disposition)];
                if (Object.keys(entry.disposition).length === 0) delete entry.disposition;
            }
        } else if (field === 'delay') {
            // value is a number as string
            const num = value === undefined || value === '' ? undefined : Number(value);
            if (num === undefined || isNaN(num)) {
                delete entry.delay;
            } else {
                entry.delay = num;
            }
        } else if (field === 'deleteTag' && value) {
            // Empty string marks a tag as deleted (preserves the key for undo)
            if (!entry.tags) entry.tags = {};
            entry.tags[value] = '';
        } else if (field === 'undeleteTag' && value) {
            // Remove a tag override entry, restoring source value
            if (entry.tags) {
                delete entry.tags[value];
                if (Object.keys(entry.tags).length === 0) delete entry.tags;
            }
        } else if (field === 'renameTagKey' && value) {
            // Rename a tag key: value is "oldKey\x00newKey"
            const sepIdx = value.indexOf('\x00');
            if (sepIdx > 0) {
                const oldKey = value.slice(0, sepIdx);
                const newKey = value.slice(sepIdx + 1);
                if (!entry.tags) entry.tags = {};
                const existingVal = entry.tags[oldKey];
                delete entry.tags[oldKey];
                entry.tags[newKey] = existingVal ?? '';
            }
        } else if (field === 'clearDispositions') {
            delete entry.disposition;
        }

        // Clean up empty entries
        const e = d.queueTrackOverrides![props.episodeId][stableKey];
        if (Object.keys(e).length === 0) delete d.queueTrackOverrides![props.episodeId][stableKey];
        if (Object.keys(d.queueTrackOverrides![props.episodeId]).length === 0) delete d.queueTrackOverrides![props.episodeId];
    });

    queueStore.invalidateEpisode(props.episodeId);
}

// ─── Inline editing helpers (title/language) ─────────────────

/** Inline editing state for title/language. */
const editingField = ref<{ field: 'title' | 'language'; value: string } | null>(null);
const fieldInputRef = ref<HTMLInputElement | null>(null);

function startEdit(field: 'title' | 'language') {
    const current = field === 'title' ? props.track.title : props.track.language;
    editingField.value = { field, value: current ?? '' };
    nextTick(() => {
        fieldInputRef.value?.focus();
    });
}

function commitEdit() {
    if (!editingField.value || isThisEpisodeMuxing.value) return;
    const { field, value } = editingField.value;

    // Persist to project data and emit to parent
    updateTrackOverride(field, value || undefined);
    emit('update-track', props.track.index, field, value || undefined);

    editingField.value = null;
}

function cancelEdit() {
    editingField.value = null;
}

/** Reset a metadata field back to the source-modified value. */
function resetField(field: 'title' | 'language') {
    if (isThisEpisodeMuxing.value) return;

    const muxed = field === 'title' ? props.track.muxedTitle : props.track.muxedLanguage;
    // Delete the override so the muxer uses the source-modified value
    updateTrackOverride(field, undefined);
    // Update local display to show the source-modified value
    emit('update-track', props.track.index, field, muxed);
}

/** True when the current title differs from the source-modified title. */
const titleOverridden = computed(() => props.track.title !== props.track.muxedTitle);
/** True when the current language differs from the source-modified language. */
const languageOverridden = computed(() => props.track.language !== props.track.muxedLanguage);

// ─── Delay editing ──────────────────────────────────────────

/** True when the current delay differs from the source-modified delay. */
const delayOverridden = computed(() => props.track.currentDelay !== props.track.muxedDelay);

/** Persist a delay override. */
function updateDelay(value: string) {
    if (isThisEpisodeMuxing.value || !props.track.matched) return;
    const num = value === '' ? undefined : Number(value);
    if (num !== undefined && isNaN(num)) return;
    updateTrackOverride('delay', num !== undefined ? String(num) : undefined);
    // Notify parent to update local state
    emit('update-track-delay', props.track.index, num ?? props.track.muxedDelay);
}

/** Reset delay back to the source-modified value. */
function resetDelay() {
    if (isThisEpisodeMuxing.value || !props.track.matched) return;
    updateTrackOverride('delay', undefined);
    emit('update-track-delay', props.track.index, props.track.muxedDelay);
}

// ─── Disposition editing ─────────────────────────────────────

/** Set of disposition flags currently active on this track (by display label). */
const activeDisp = computed(() => new Set(props.track.dispositionFlags));

/** Toggle a single disposition flag. */
function toggleDisposition(dispKey: string, label: string) {
    if (isThisEpisodeMuxing.value || !props.track.matched) return;
    const wasSet = activeDisp.value.has(label);

    const key = Number(dispKey);
    updateTrackOverride('disposition', String(!wasSet), key);
    emit('update-track-disposition', props.track.index, key, !wasSet);
}

/** True when current dispositions differ from source-modified dispositions. */
const dispositionsOverridden = computed(() => {
    const current = [...props.track.dispositionFlags].sort();
    const muxed = [...(props.track.muxedDispositions ?? [])].sort();
    return current.length !== muxed.length || current.some((f, i) => f !== muxed[i]);
});

/** Reset all disposition overrides, reverting to source-modified dispositions. */
function resetDispositions() {
    if (isThisEpisodeMuxing.value || !props.track.matched) return;
    updateTrackOverride('clearDispositions', undefined);
    emit('update-track-disposition', props.track.index, -1, false);
}

// ─── Tags editing ────────────────────────────────────────────

function updateMime(_key: string, value: string | undefined) {
    updateTrackOverride('tags', JSON.stringify({ mimetype: value || undefined }));
}

function updateFilename(value: string | undefined) {
    updateTrackOverride('tags', JSON.stringify({ filename: value || undefined }));
}

// ─── Inline tags ────────────────────────────────────────────

/** Stable key used in queueTrackOverrides for this track. */
const stableKey = computed(() => `${props.track.demuxerMapKey}:${props.track.fileStreamIndex}`);

/**
 * Load existing override tags from the project store on mount.
 * Includes both additions and deletion markers ('').
 */
function loadOverrideTags(): Record<string, string> {
    const project = projectStore.currentProject;
    if (!project) return {};
    const epOverrides = project.queueTrackOverrides?.[props.episodeId];
    if (!epOverrides) return {};
    return epOverrides[stableKey.value]?.tags ?? {};
}

/** Tags that the user has explicitly added or modified (from overrides).
 *  Keys with value '' indicate a deletion of a source-original tag. */
const overrideTags = ref<Record<string, string>>(loadOverrideTags());

/** Keys that are displayed in their own dedicated rows (not shown as tags). */
const TAG_RESERVED_KEYS = new Set(['title', 'language', 'filename', 'mimetype']);

/**
 * Compute the effective tags to display:
 * - Start with muxed tags (post-source-modifications, excludes reserved keys)
 * - Override with user changes (overrideTags)
 * - Keys with empty string value are marked as "deleted"
 */
const effectiveTags = computed(() => {
    const merged: Record<string, { value: string; deleted: boolean; overridden: boolean; addedBySource: boolean; modifiedBySource: boolean }> = {};

    // Start with muxed tags (post-source-modifications)
    for (const [key, val] of Object.entries(props.track.muxedTags)) {
        if (TAG_RESERVED_KEYS.has(key)) continue;
        const originalVal = props.track.originalTags[key];
        const addedBySource = originalVal === undefined;
        const modifiedBySource = originalVal !== undefined && originalVal !== val;
        merged[key] = { value: val, deleted: false, overridden: false, addedBySource, modifiedBySource };
    }

    // Also include original tags that got removed by source modifications
    // (marked as "deleted" but with a flag that the source removed them)
    for (const [key, val] of Object.entries(props.track.originalTags)) {
        if (TAG_RESERVED_KEYS.has(key)) continue;
        if (!(key in props.track.muxedTags)) {
            merged[key] = { value: val, deleted: true, overridden: false, addedBySource: false, modifiedBySource: false };
        }
    }

    // Apply override tags
    for (const [key, val] of Object.entries(overrideTags.value)) {
        if (TAG_RESERVED_KEYS.has(key)) continue;
        if (val === '') {
            if (merged[key]) {
                // Deletion marker for an existing tag
                merged[key].deleted = true;
            } else {
                // User-added tag with no value yet (just created)
                merged[key] = { value: '', deleted: false, overridden: true, addedBySource: false, modifiedBySource: false };
            }
        } else {
            merged[key] = {
                value: val,
                deleted: false,
                overridden: true,
                addedBySource: false,
                modifiedBySource: false,
            };
        }
    }

    return merged;
});

/** Inline editing state for a tag: the original key (matches effectiveTags key),
 *  the potentially-renamed key, and the value. */
const editingTag = ref<{ key: string; newKey: string; value: string } | null>(null);
/** Ref to the tag key input for auto-focus on edit start. */
const tagKeyInputRef = ref<HTMLInputElement | null>(null);

function startEditTagValue(key: string) {
    if (!props.track.matched || isThisEpisodeMuxing.value) return;
    const tag = effectiveTags.value[key];
    if (tag?.deleted) return;
    editingTag.value = { key, newKey: key, value: tag?.value ?? '' };
    nextTick(() => {
        // ref is inside v-for so Vue stores it as an array
        const el = tagKeyInputRef.value;
        const input = Array.isArray(el) ? (el[0] as HTMLInputElement | undefined) : el;
        input?.focus();
    });
}

/**
 * Handle blur on the tag key input.
 * Only commit if focus is NOT moving to the tag value input (same row).
 */
function onTagKeyBlur(e: FocusEvent) {
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.tagName === 'INPUT') return;
    commitTagValue();
}

/**
 * Handle blur on the tag value input.
 * Only commit if focus is NOT moving to the tag key input (same row).
 */
function onTagValueBlur(e: FocusEvent) {
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.tagName === 'INPUT') return;
    commitTagValue();
}

function commitTagValue() {
    const et = editingTag.value;
    if (!et || isThisEpisodeMuxing.value) return;

    const next = { ...overrideTags.value };
    const val = et.value;
    const keyChanged = et.newKey !== et.key;

    if (keyChanged) {
        // Rename: remove old key, add new key
        delete next[et.key];
        next[et.newKey] = val;
        updateTrackOverride('undeleteTag', et.key);
        updateTrackOverride('tags', JSON.stringify({ [et.newKey]: val }));
    } else {
        next[et.key] = val;
        updateTrackOverride('tags', JSON.stringify({ [et.key]: val }));
    }

    overrideTags.value = next;
    editingTag.value = null;
}

function cancelTagEdit() {
    editingTag.value = null;
}

/** Create a new tag with a placeholder key and auto-enter edit mode. */
function addTag() {
    const key = `tag_${Object.keys(overrideTags.value).length + 1}`;
    overrideTags.value = { ...overrideTags.value, [key]: '' };
    editingTag.value = { key, newKey: key, value: '' };
}

/**
 * Remove/delete a tag.
 * - Source-original/muxed tags: set deletion marker '' (preserves undo).
 * - User-added tags (only in overrideTags): remove entirely.
 */
function removeTag(key: string) {
    const existsInMuxed = key in props.track.muxedTags;
    if (existsInMuxed) {
        // Source tag — set deletion marker in both store and local
        overrideTags.value = { ...overrideTags.value, [key]: '' };
        updateTrackOverride('deleteTag', key);
    } else {
        // User-added tag — remove entirely
        const next = { ...overrideTags.value };
        delete next[key];
        overrideTags.value = next;
        updateTrackOverride('undeleteTag', key);
    }
}

/** Restore a deleted or overridden tag to its original source value. */
function undeleteTag(key: string) {
    const next = { ...overrideTags.value };
    delete next[key];
    overrideTags.value = next;
    // Remove the tag entry from overrides (restores source/muxed value in backend)
    updateTrackOverride('undeleteTag', key);
}

// ─── Progress helpers ────────────────────────────────────────

const progressPercent = computed<number>(() => {
    const tp = props.trackProgress;
    if (!tp) return -1;
    return tp.percent;
});

const progressColor = computed(() => {
    const pct = progressPercent.value;
    if (pct < 0) return 'bg-gray-300 dark:bg-gray-600';
    if (pct >= 100) return 'bg-green-500';
    return 'bg-blue-500';
});

// ─── Type + codec badge ─────────────────────────────────────

const typeCodecBadge = computed(() => {
    const ti = STREAM_TYPE_INFO[props.track.type] ?? STREAM_TYPE_INFO.video;
    return {
        color: ti.color,
        icon: props.track.type === 'video' ? Video
            : props.track.type === 'audio' ? Volume2
                : props.track.type === 'subtitle' ? MessageSquareText
                    : props.track.type === 'attachment' ? Paperclip
                        : Video,
    };
});

// ─── Disposition options list ────────────────────────────────

const DISPOSITION_OPTIONS = [
    { value: '1', label: 'Default' },
    { value: '2', label: 'Dub' },
    { value: '4', label: 'Original' },
    { value: '8', label: 'Comment' },
    { value: '16', label: 'Lyrics' },
    { value: '32', label: 'Karaoke' },
    { value: '64', label: 'Forced' },
    { value: '128', label: 'Hearing Impaired' },
    { value: '256', label: 'Visual Impaired' },
    { value: '512', label: 'Clean Effects' },
    { value: '1024', label: 'Attached Picture' },
    { value: '2048', label: 'Timed Thumbnails' },
    { value: '4096', label: 'Non-Diegetic' },
    { value: '65536', label: 'Captions' },
    { value: '131072', label: 'Descriptions' },
    { value: '262144', label: 'Metadata' },
    { value: '524288', label: 'Dependent' },
    { value: '1048576', label: 'Still Image' },
    { value: '2097152', label: 'Multilayer' },
];
</script>

<template>
    <div class="border-t">
        <!-- Track header: click to expand -->
        <button
            :data-stream-type="track.type"
            :data-stream-index="track.index"
            class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-muted/30 transition-colors"
            :class="{ 'opacity-50': !track.matched }"
            @click="emit('toggle-expand', track.index)"
        >
            <!-- Stream index -->
            <span class="font-mono text-muted-foreground w-6 text-right tabular-nums shrink-0">#{{ track.index }}</span>

            <!-- Combined type + codec pill (like StreamMatchPreview) -->
            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium font-mono shrink-0"
                :class="typeCodecBadge.color">
                <component :is="typeCodecBadge.icon" class="w-3 h-3 shrink-0" />
                {{ track.codec || '?' }}
            </span>

            <!-- Attachment filename (like StreamMatchPreview) -->
            <span v-if="track.type === 'attachment' && (track.filename ?? track.title)"
                class="text-muted-foreground truncate max-w-[200px] shrink min-w-0"
                :title="track.filename ?? track.title">
                {{ track.filename ?? track.title }}
            </span>

            <!-- Language (if available) -->
            <span v-if="track.language" class="text-muted-foreground shrink-0">{{ track.language }}</span>

            <!-- Title (if available) -->
            <span v-if="track.title" class="text-muted-foreground truncate max-w-[160px] shrink min-w-0">{{ track.title }}</span>

            <!-- Packets written / pps (during muxing) -->
            <template v-if="trackProgress">
                <span class="text-muted-foreground tabular-nums shrink-0 ml-auto">
                    {{ trackProgress.packetsWritten.toLocaleString() }} pkts
                </span>
                <span v-if="trackProgress.packetsPerSecond > 0" class="text-muted-foreground tabular-nums shrink-0">
                    ({{ trackProgress.packetsPerSecond >= 1000
                        ? (trackProgress.packetsPerSecond / 1000).toFixed(1) + 'K'
                        : trackProgress.packetsPerSecond }}/s)
                </span>
            </template>

            <!-- Spacer -->
            <span class="flex-1"></span>

            <!-- Progress bar (thin) -->
            <div v-if="trackProgress && progressPercent >= 0" class="w-20 h-1 bg-gray-200 dark:bg-gray-700 rounded-full shrink-0">
                <div
                    class="h-1 rounded-full transition-all duration-300"
                    :class="progressColor"
                    :style="{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }"
                />
            </div>

            <!-- Expand chevron -->
            <span class="text-muted-foreground shrink-0 ml-1">
                <svg class="w-3 h-3 transition-transform duration-200" :class="{ 'rotate-180': expanded }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </span>
        </button>

        <!-- Expanded details: grid layout like StreamMatchPreview -->
        <div v-if="expanded" class="border-t bg-muted/30 px-4 py-2">
            <!-- ── Attachment: MIME + filename ──────────────────── -->
            <template v-if="track.type === 'attachment'">
                <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div class="flex justify-between py-0.5 items-center gap-1">
                        <span class="text-muted-foreground">MIME</span>
                        <div class="flex items-center gap-1 max-w-[65%] justify-end">
                            <input
                                class="w-full h-5 rounded border border-input bg-background px-1 text-[10px] font-mono text-right"
                                :value="track.mimetype ?? ''"
                                :disabled="!track.matched || isThisEpisodeMuxing"
                                placeholder="—"
                                @change="track.matched && !isThisEpisodeMuxing && updateMime(track.mimetype ?? '', ($event.target as HTMLInputElement).value || undefined)"
                            />
                        </div>
                    </div>
                    <div class="flex justify-between py-0.5 items-center gap-1">
                        <span class="text-muted-foreground">Filename</span>
                        <div class="flex items-center gap-1 max-w-[65%] justify-end">
                            <input
                                class="w-full h-5 rounded border border-input bg-background px-1 text-[10px] font-mono text-right"
                                :value="track.filename ?? track.title ?? ''"
                                :disabled="!track.matched || isThisEpisodeMuxing"
                                placeholder="—"
                                @change="track.matched && !isThisEpisodeMuxing && updateFilename(($event.target as HTMLInputElement).value || undefined)"
                            />
                        </div>
                    </div>
                </div>
            </template>

            <!-- ── Non-attachment: codec, title, language, dispositions, tags ── -->
            <template v-else>
                <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <!-- Codec (read-only) -->
                    <div class="flex justify-between py-0.5 items-center gap-1">
                        <span class="text-muted-foreground">Codec</span>
                        <span class="font-mono truncate text-right max-w-[65%]">{{ track.codec || '—' }}</span>
                    </div>

                    <!-- Title (editable with blur-commit + Undo2 reset) -->
                    <div class="flex justify-between py-0.5 items-center gap-1">
                        <span class="text-muted-foreground">Title</span>
                        <div class="flex items-center gap-1 max-w-[65%] justify-end">
                            <template v-if="editingField?.field === 'title'">
                                <input
                                    ref="fieldInputRef"
                                    class="w-full h-5 rounded border border-input bg-background px-1 text-[10px] font-mono text-right"
                                    v-model="editingField.value"
                                    :disabled="!track.matched || isThisEpisodeMuxing"
                                    placeholder="—"
                                    @keydown.enter.stop
                                    @keyup.enter="commitEdit"
                                    @keyup.escape="cancelEdit"
                                    @blur="commitEdit"
                                />
                            </template>
                            <template v-else>
                                <span class="font-mono truncate cursor-default text-right"
                                    :title="track.title ?? ''">{{ track.title || '—' }}</span>
                                <!-- Reset button (appears when value differs from original) -->
                                <button v-if="titleOverridden"
                                    class="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5"
                                    title="Reset to original source value"
                                    :disabled="!track.matched || isThisEpisodeMuxing"
                                    @click="resetField('title')">
                                    <Undo2 class="w-2.5 h-2.5" />
                                </button>
                                <!-- Edit button -->
                                <button
                                    class="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted/50"
                                    title="Edit title"
                                    :disabled="!track.matched || isThisEpisodeMuxing"
                                    @click="startEdit('title')">
                                    <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                                </button>
                            </template>
                        </div>
                    </div>

                    <!-- Language (editable with blur-commit + Undo2 reset) -->
                    <div class="flex justify-between py-0.5 items-center gap-1">
                        <span class="text-muted-foreground">Language</span>
                        <div class="flex items-center gap-1 max-w-[65%] justify-end">
                            <template v-if="editingField?.field === 'language'">
                                <input
                                    ref="fieldInputRef"
                                    class="w-full h-5 rounded border border-input bg-background px-1 text-[10px] font-mono text-right"
                                    v-model="editingField.value"
                                    :disabled="!track.matched || isThisEpisodeMuxing"
                                    placeholder="—"
                                    @keydown.enter.stop
                                    @keyup.enter="commitEdit"
                                    @keyup.escape="cancelEdit"
                                    @blur="commitEdit"
                                />
                            </template>
                            <template v-else>
                                <span class="font-mono truncate cursor-default text-right">{{ track.language || '—' }}</span>
                                <!-- Reset button (appears when value differs from original) -->
                                <button v-if="languageOverridden"
                                    class="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5"
                                    title="Reset to original source value"
                                    :disabled="!track.matched || isThisEpisodeMuxing"
                                    @click="resetField('language')">
                                    <Undo2 class="w-2.5 h-2.5" />
                                </button>
                                <!-- Edit button -->
                                <button
                                    class="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted/50"
                                    title="Edit language"
                                    :disabled="!track.matched || isThisEpisodeMuxing"
                                    @click="startEdit('language')">
                                    <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                                </button>
                            </template>
                        </div>
                    </div>

                    <!-- Dispositions (badges + skeleton add button) -->
                    <div class="flex justify-between py-0.5 items-center gap-1">
                        <span class="text-muted-foreground">Dispositions</span>
                        <div class="flex items-center gap-1 max-w-[65%] justify-end">
                            <div class="flex flex-wrap gap-1 justify-end">
                                <!-- Badge for each enabled disposition -->
                                <span v-for="flag in track.dispositionFlags" :key="flag"
                                    class="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono bg-muted/30">
                                    {{ flag }}
                                </span>
                                <!-- Reset dispositions to source-modified -->
                                <button v-if="dispositionsOverridden"
                                    class="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5"
                                    title="Reset to source-modified dispositions"
                                    @click="resetDispositions">
                                    <Undo2 class="w-2.5 h-2.5" />
                                </button>
                                <!-- Skeleton + button to open the popover -->
                                <PopoverRoot>
                                    <PopoverTrigger as-child>
                                        <button
                                            class="inline-flex items-center justify-center w-5 h-5 rounded border border-dashed border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-[10px]"
                                            :disabled="!track.matched || isThisEpisodeMuxing">
                                            <Plus class="w-3 h-3" />
                                        </button>
                                    </PopoverTrigger>
                                    <PopoverPortal>
                                        <PopoverContent side="left" align="start" :side-offset="4"
                                            class="z-50 rounded-lg border bg-popover p-2.5 text-popover-foreground shadow-md outline-none w-56">
                                            <label class="text-xs font-medium block mb-1.5">Dispositions</label>
                                            <div class="flex flex-wrap gap-1.5">
                                                <div v-for="opt in DISPOSITION_OPTIONS" :key="opt.value"
                                                    class="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-background/60 border text-[10px]">
                                                    <SwitchRoot
                                                        :model-value="activeDisp.has(opt.label)"
                                                        class="inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input h-3 w-5"
                                                        @update:model-value="() => toggleDisposition(opt.value, opt.label)">
                                                        <SwitchThumb class="pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-transform h-2 w-2 data-[state=checked]:translate-x-2 data-[state=unchecked]:translate-x-0" />
                                                    </SwitchRoot>
                                                    <span>{{ opt.label }}</span>
                                                </div>
                                            </div>
                                    </PopoverContent>
                                </PopoverPortal>
                            </PopoverRoot>
                        </div>
                    </div>
                    </div>

                    <!-- Delay (editable for video/audio/subtitle) -->
                    <div class="flex justify-between py-0.5 items-center gap-1">
                        <span class="text-muted-foreground">Delay (ms)</span>
                        <div class="flex items-center gap-1 max-w-[65%] justify-end">
                            <div class="relative inline-flex items-center">
                                <input type="number"
                                    class="w-20 h-5 rounded border border-input bg-background px-1 text-[10px] font-mono text-right pr-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    :value="track.currentDelay"
                                    :disabled="!track.matched || isThisEpisodeMuxing"
                                    placeholder="0"
                                    @keydown.enter.stop
                                    @keyup.enter="($event.target as HTMLInputElement).blur()"
                                    @change="updateDelay(($event.target as HTMLInputElement).value)" />
                                <button v-if="delayOverridden"
                                    class="absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                                    title="Reset to original source delay"
                                    @click="resetDelay()">
                                    <Undo2 class="w-2.5 h-2.5" />
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- ── Tags (inline rows in the grid) ── -->
                    <template v-for="(tag, key) in effectiveTags" :key="key">
                        <div class="flex justify-between py-0.5 items-center gap-1">
                            <template v-if="editingTag?.key === key">
                                <!-- Editing: key input on left, value input on right -->
                                <input
                                    ref="tagKeyInputRef"
                                    class="h-5 rounded border border-input bg-background px-1 text-[10px] font-mono w-full max-w-[35%]"
                                    v-model="editingTag.newKey"
                                    :disabled="!track.matched || isThisEpisodeMuxing"
                                    placeholder="key"
                                    @keydown.enter.stop
                                    @keydown.space.stop
                                    @keyup.enter="commitTagValue"
                                    @keyup.escape="cancelTagEdit"
                                    @blur="onTagKeyBlur($event)"
                                />
                                <div class="flex items-center gap-1 max-w-[65%] justify-end">
                                    <input
                                        class="h-5 rounded border border-input bg-background px-1 text-[10px] font-mono text-right w-full"
                                        v-model="editingTag.value"
                                        :disabled="!track.matched || isThisEpisodeMuxing"
                                        placeholder="value"
                                        @keydown.enter.stop
                                        @keydown.space.stop
                                        @keyup.enter="commitTagValue"
                                        @keyup.escape="cancelTagEdit"
                                        @blur="onTagValueBlur($event)"
                                    />
                                </div>
                            </template>
                            <template v-else-if="tag.deleted">
                                <span class="text-muted-foreground font-mono text-[10px] truncate max-w-[40%]" :title="key">{{ key }}</span>
                                <div class="flex items-center gap-1 max-w-[60%] justify-end">
                                    <span class="line-through text-muted-foreground font-mono text-[10px]">(deleted)</span>
                                    <button
                                        class="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5"
                                        title="Restore original source value"
                                        @click="undeleteTag(key)">
                                        <Undo2 class="w-2.5 h-2.5" />
                                    </button>
                                </div>
                            </template>
                            <template v-else>
                                <span class="text-muted-foreground font-mono text-[10px] truncate max-w-[40%]" :title="key">{{ key }}</span>
                                <div class="flex items-center gap-1 max-w-[60%] justify-end">
                                    <span class="font-mono truncate text-right max-w-[80px]" :title="tag.value">{{ tag.value }}</span>
                                    <!-- Edit button (after value, like title/language) -->
                                    <button
                                        class="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted/50"
                                        title="Edit tag"
                                        :disabled="!track.matched || isThisEpisodeMuxing"
                                        @click="startEditTagValue(key)">
                                        <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                                    </button>
                                    <!-- Undo2: restore original muxed value -->
                                    <button v-if="tag.overridden"
                                        class="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5"
                                        title="Restore original source value"
                                        @click="undeleteTag(key)">
                                        <Undo2 class="w-2.5 h-2.5" />
                                    </button>
                                    <!-- X: remove/delete tag -->
                                    <button
                                        class="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5"
                                        title="Remove tag"
                                        @click="removeTag(key)">
                                        <X class="w-2.5 h-2.5" />
                                    </button>
                                </div>
                            </template>
                        </div>
                    </template>
                    <!-- Add Tag row -->
                    <div class="flex justify-between py-0.5 items-center gap-1">
                        <span class="text-muted-foreground"></span>
                        <button
                            class="inline-flex items-center justify-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors border border-dashed border-input rounded px-2 py-0.5"
                            :disabled="!track.matched || isThisEpisodeMuxing"
                            @click="addTag">
                            <Plus class="w-3 h-3" /> Add Tag
                        </button>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>
