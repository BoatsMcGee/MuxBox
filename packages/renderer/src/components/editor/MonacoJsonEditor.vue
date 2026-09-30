<script setup lang="ts">
import { cn } from '@/lib/utils';
import { registerMonacoThemeSetter, unregisterMonacoThemeSetter } from '@/lib/monaco-theme';
import { ref, computed, onMounted, onUnmounted, watch, shallowRef, nextTick } from 'vue';
import type { editor as monacoEditor, Range as MonacoRange } from 'monaco-editor';
import { Check, ChevronDown, Copy, EyeOff, Eye, Highlighter, WrapText } from '@lucide/vue';

const LINE_HEIGHT = 18;
const MIN_LINES = 3;
const MAX_LINES = 16;
const RESIZE_HANDLE_HEIGHT = 20; // h-5

interface Props {
    modelValue: unknown;
    schema?: Record<string, unknown>;
    class?: string;
    /** When set to a stream index, the editor will scroll to and highlight that stream's JSON entry */
    revealIndex?: number | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: unknown): void;
    (e: 'switch-to-visual'): void;
}>();

const editorContainer = ref<HTMLDivElement | null>(null);
const editor = shallowRef<monacoEditor.IStandaloneCodeEditor | null>(null);

// ─── Auto-height state ──────────────────────────────────────
const editorHeight = ref<number | null>(null); // null = auto-compute
const userResizedHeight = ref<number | null>(null); // set by drag
const isDraggingResize = ref(false);

/** Number of lines in the current JSON content */
const contentLineCount = computed(() => {
    const ed = editor.value;
    if (!ed) {
        // Approximate from modelValue before editor mounts
        try {
            const str = JSON.stringify(props.modelValue, null, 2);
            return str.split('\n').length;
        } catch { return MIN_LINES; }
    }
    return ed.getModel()?.getLineCount() ?? MIN_LINES;
});
/** Content area height (editor only, excluding border & resize handle) */
const contentHeight = computed(() => {
    if (userResizedHeight.value !== null) return userResizedHeight.value;
    const lines = Math.max(contentLineCount.value, MIN_LINES);
    return Math.min(lines * LINE_HEIGHT, MAX_LINES * LINE_HEIGHT);
});

/** Total outer div height = content + 2px border + resize handle */
const outerHeight = computed(() => contentHeight.value + 2 + RESIZE_HANDLE_HEIGHT);

function updateEditorHeight() {
    editorHeight.value = outerHeight.value;
}

// ─── Resize handle ──────────────────────────────────────────
function onResizeStart(e: MouseEvent) {
    isDraggingResize.value = true;
    const startY = e.clientY;
    const startContentHeight = contentHeight.value;

    function onMove(ev: MouseEvent) {
        if (!isDraggingResize.value) return;
        const delta = ev.clientY - startY;
        const newContent = Math.max(MIN_LINES * LINE_HEIGHT, Math.min(MAX_LINES * LINE_HEIGHT * 2, startContentHeight + delta));
        userResizedHeight.value = newContent;
        editorHeight.value = newContent + 2 + RESIZE_HANDLE_HEIGHT;
    }

    function onUp() {
        isDraggingResize.value = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

/** Runtime monaco module, typed with only the parts we actually use. */
interface MonacoModule {
    editor: {
        create: (dom: HTMLElement, options?: monacoEditor.IStandaloneEditorConstructionOptions, override?: monacoEditor.IEditorOverrideServices) => monacoEditor.IStandaloneCodeEditor;
        createModel: (value: string, language?: string) => monacoEditor.ITextModel;
        createDiffEditor: (dom: HTMLElement, options?: monacoEditor.IDiffEditorConstructionOptions) => monacoEditor.IStandaloneDiffEditor;
        getModelMarkers: (filter: { resource?: monacoEditor.ITextModel['uri']; owner?: string; severity?: number }) => { startLineNumber: number; startColumn: number; message: string; severity: number }[];
        onDidChangeMarkers: (listener: (resources: monacoEditor.ITextModel['uri'][]) => void) => { dispose: () => void };
        setTheme: (theme: string) => void;
    };
    Range: typeof MonacoRange;
    languages: {
        json: {
            jsonDefaults: {
                setDiagnosticsOptions: (opts: Record<string, unknown>) => void;
            };
        };
    };
}
const monacoRef = shallowRef<MonacoModule | null>(null);

/** Dispose handle for the marker-change listener */
let markerListenerDisposable: { dispose: () => void } | null = null;

/** The current decoration collection so we can clear it on re-reveal */
let decorationsCollection: monacoEditor.IEditorDecorationsCollection | null = null;

/** Tracks the current highlight range for "copy highlighted block" */
const highlightedRange = ref<{ openLine: number; closeLine: number } | null>(null);

/** Whether word wrap is enabled */
const wordWrapEnabled = ref(true);

/** Whether the stream highlight (yellow background) is visible */
const highlightEnabled = ref(true);

/** Whether the dropdown menu is open */
const dropdownOpen = ref(false);

const dropdownTrigger = ref<HTMLButtonElement | null>(null);
const dropdownMenu = ref<HTMLDivElement | null>(null);

// ─── Dropdown helpers ──────────────────────────────────────

function toggleDropdown() {
    dropdownOpen.value = !dropdownOpen.value;
    if (dropdownOpen.value) {
        nextTick(() => {
            document.addEventListener('click', handleOutsideClick);
        });
    }
}

function closeDropdown() {
    dropdownOpen.value = false;
    document.removeEventListener('click', handleOutsideClick);
}

function handleOutsideClick(e: MouseEvent) {
    const target = e.target as Node;
    if (
        dropdownTrigger.value &&
        !dropdownTrigger.value.contains(target) &&
        dropdownMenu.value &&
        !dropdownMenu.value.contains(target)
    ) {
        closeDropdown();
    }
}

// ─── Dirty tracking & validation ───────────────────────────

/** The value when the editor was first opened (user switched to JSON mode). */
const loadedValue = ref('');

/** The last valid+committed JSON string — used to determine dirty state */
const lastCommittedValue = ref('');

/** Bumped on every editor content change so isDirty re-evaluates. */
const contentRev = ref(0);

/** Whether the current editor content differs from the last committed value */
const isDirty = computed(() => {
    const ed = editor.value;
    if (!ed) return false;
    void contentRev.value;
    return ed.getValue() !== lastCommittedValue.value;
});

/** Bump this on marker changes to force re-evaluation of marker-related computed properties. */
const validationRev = ref(0);

/** Pending parsed value while waiting for async validation to settle. */
let pendingParsedValue: unknown = null;
let pendingValueStr: string | null = null;

/** True when the current editor content cannot be parsed as JSON (synchronous check). */
const syntaxError = ref(false);

/** Schema / syntax error markers from Monaco */
function getModelMarkers() {
    const model = editor.value?.getModel();
    if (!model || !monacoRef.value) return [];
    return monacoRef.value.editor.getModelMarkers({ resource: model.uri });
}

/** True when the model has at least one error marker OR a synchronous syntax error. */
const hasErrors = computed(() => {
    void validationRev.value; // capture dependency
    if (syntaxError.value) return true;
    return getModelMarkers().length > 0;
});

/** Human-readable error messages with line numbers */
const errorMessages = computed(() => {
    void validationRev.value; // capture dependency
    return getModelMarkers().map(m => `Line ${m.startLineNumber}:${m.startColumn}: ${m.message}`);
});

/** Delay before auto-committing a valid edit when no marker change fires (valid→valid). */
const SETTLE_COMMIT_DELAY_MS = 2000;

/** Timer handle for the debounced settled-validation commit. */
let settleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Commit the pending parsed value if the editor is currently valid
 * (no syntax error and no schema markers). No-op otherwise.
 */
function commitPending(): void {
    const ed = editor.value;
    if (!ed) return;
    if (syntaxError.value) return;
    if (pendingParsedValue === null) return;
    if (getModelMarkers().length > 0) return;
    // Skip if the pending value is unchanged from the last committed value
    // (e.g. an external setValue re-parsed the same content).
    if (pendingValueStr === lastCommittedValue.value) {
        pendingParsedValue = null;
        pendingValueStr = null;
        return;
    }
    emit('update:modelValue', pendingParsedValue);
    lastCommittedValue.value = pendingValueStr!;
    pendingParsedValue = null;
    pendingValueStr = null;
}

/**
 * Debounce a settled-validation commit so rapid typing doesn't emit on every
 * keystroke. Monaco only fires onDidChangeMarkers when the marker set changes,
 * so a valid→valid edit never triggers it — this timer is the fallback.
 */
function scheduleSettledCommit(): void {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
        settleTimer = null;
        commitPending();
    }, SETTLE_COMMIT_DELAY_MS);
}

/** In-place diff view toggle */
const showDiff = ref(false);
const diffEditor = shallowRef<monacoEditor.IStandaloneDiffEditor | null>(null);

// ─── Word wrap toggle ──────────────────────────────────────

function applyWordWrap() {
    const ed = editor.value;
    if (!ed) return;
    ed.updateOptions({ wordWrap: wordWrapEnabled.value ? 'on' : 'off' });
}

function toggleWordWrap() {
    wordWrapEnabled.value = !wordWrapEnabled.value;
    applyWordWrap();
}

// ─── Highlight toggle ──────────────────────────────────────

function reapplyHighlight() {
    const ed = editor.value;
    const monaco = monacoRef.value;
    if (!ed || !monaco || showDiff.value) return;

    // Clear existing
    decorationsCollection?.clear();
    decorationsCollection = null;

    if (highlightEnabled.value && highlightedRange.value) {
        const { openLine, closeLine } = highlightedRange.value;
        decorationsCollection = ed.createDecorationsCollection([
            {
                range: new monaco.Range(openLine, 1, closeLine, 1),
                options: {
                    isWholeLine: true,
                    className: 'monaco-stream-highlight',
                    linesDecorationsClassName: 'monaco-stream-gutter-marker',
                },
            },
        ]);
    }
}

function toggleHighlight() {
    highlightEnabled.value = !highlightEnabled.value;
    reapplyHighlight();
}

// ─── Copy actions ──────────────────────────────────────────

function getEditorModel() {
    return editor.value?.getModel() ?? null;
}

async function copyHighlightedBlock() {
    const model = getEditorModel();
    if (!model || !highlightedRange.value) return;

    const { openLine, closeLine } = highlightedRange.value;
    const lines: string[] = [];
    for (let line = openLine; line <= closeLine; line++) {
        lines.push(model.getLineContent(line));
    }
    const text = lines.join('\n');
    await navigator.clipboard.writeText(text);
    closeDropdown();
}

async function copyAllJson() {
    const ed = editor.value;
    if (!ed) return;
    const text = ed.getValue();
    await navigator.clipboard.writeText(text);
    closeDropdown();
}

// ─── Schema ────────────────────────────────────────────────

function applySchema(monaco: MonacoModule, schema: Record<string, unknown> | undefined) {
    const jsonDefaults = monaco.languages.json?.jsonDefaults;
    if (!jsonDefaults) return;

    const schemaUri = 'file:///stream-match-schema.json';
    jsonDefaults.setDiagnosticsOptions({
        validate: true,
        schemas: schema
            ? [
                {
                    uri: schemaUri,
                    fileMatch: ['*'],
                    schema,
                },
            ]
            : [],
        enableSchemaRequest: false,
    });
}

// ─── Find enclosing object range ───────────────────────────

function findEnclosingObjectRange(
    model: monacoEditor.ITextModel,
    anchorLine: number,
    anchorColumn: number,
): { openLine: number; closeLine: number } | null {
    let depth = 0;
    let openLine = -1;
    for (let line = anchorLine; line >= 1; line--) {
        const text = model.getLineContent(line);
        const chars = line === anchorLine ? text.slice(0, anchorColumn - 1) : text;
        for (let i = chars.length - 1; i >= 0; i--) {
            if (chars[i] === '}') depth++;
            if (chars[i] === '{') {
                depth--;
                if (depth < 0) {
                    openLine = line;
                    break;
                }
            }
        }
        if (openLine >= 0) break;
    }
    if (openLine < 0) return null;

    depth = 0;
    let closeLine = -1;
    for (let line = openLine; line <= model.getLineCount(); line++) {
        const text = model.getLineContent(line);
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '{') depth++;
            if (text[i] === '}') {
                depth--;
                if (depth === 0) {
                    closeLine = line;
                    break;
                }
            }
        }
        if (closeLine >= 0) break;
    }
    if (closeLine < 0) return null;

    return { openLine, closeLine };
}

// ─── Reveal stream ─────────────────────────────────────────

function revealStreamInEditor(trackIndex: number): void {
    const ed = editor.value;
    const monaco = monacoRef.value;
    if (!ed || !monaco) return;

    decorationsCollection?.clear();
    decorationsCollection = null;
    highlightedRange.value = null;

    const model = ed.getModel();
    if (!model) return;
    const pattern = `"index": ${trackIndex}`;
    const matches = model.findMatches(pattern, false, false, false, null, false, 1);

    if (matches.length === 0) return;

    const matchRange = matches[0].range;
    const lineNumber = matchRange.startLineNumber;
    const column = matchRange.startColumn;

    const objRange = findEnclosingObjectRange(model, lineNumber, column);
    if (!objRange) return;

    const { openLine, closeLine } = objRange;
    highlightedRange.value = { openLine, closeLine };

    if (highlightEnabled.value) {
        decorationsCollection = ed.createDecorationsCollection([
            {
                range: new monaco.Range(openLine, 1, closeLine, 1),
                options: {
                    isWholeLine: true,
                    className: 'monaco-stream-highlight',
                    linesDecorationsClassName: 'monaco-stream-gutter-marker',
                },
            },
        ]);
    }

    ed.revealLineNearTop(openLine);
    ed.setPosition({ lineNumber, column });
}

// ─── Lifecycle ─────────────────────────────────────────────

/**
 * Create and set up the regular (editable) Monaco editor in the container.
 * Called on initial mount and when toggling back from diff view.
 */
async function createRegularEditor(initialValue: string, isInitialMount = false): Promise<void> {
    const monaco = monacoRef.value!;
    if (!editorContainer.value) return;

    if (isInitialMount) {
        loadedValue.value = initialValue;
    }
    lastCommittedValue.value = initialValue;
    pendingParsedValue = null;
    pendingValueStr = null;

    const ed = monaco.editor.create(editorContainer.value, {
        value: initialValue,
        language: 'json',
        minimap: { enabled: false },
        automaticLayout: true,
        tabSize: 4,
        wordWrap: wordWrapEnabled.value ? 'on' : 'off',
    });
    editor.value = ed;

    // Set initial height based on content
    nextTick(() => updateEditorHeight());

    // Listen for marker changes (Monaco validates asynchronously)
    markerListenerDisposable = monaco.editor.onDidChangeMarkers((resources) => {
        const model = ed.getModel();
        if (!model || !resources.some(r => r.toString() === model.uri.toString())) return;

        validationRev.value++;
        // When markers clear and we have a pending valid value, emit it
        commitPending();
    });

    ed.onDidChangeModelContent(() => {
        contentRev.value++;
        const value = ed.getValue();
        try {
            const parsed = JSON.parse(value);
            syntaxError.value = false;
            pendingParsedValue = parsed;
            pendingValueStr = value;
        } catch {
            syntaxError.value = true;
            pendingParsedValue = null;
            pendingValueStr = null;
        }
        // Update height after content change
        nextTick(() => updateEditorHeight());
        // Auto-commit valid edits even when no marker change fires (valid→valid)
        scheduleSettledCommit();
    });
}

// ─── Diff view toggle ─────────────────────────────────────

async function toggleDiffView(): Promise<void> {
    const monaco = monacoRef.value;
    if (!monaco || !editorContainer.value) return;

    if (!showDiff.value) {
        // Switch TO diff view
        const currentValue = editor.value?.getValue() ?? '';

        // Dispose regular editor + marker listener
        markerListenerDisposable?.dispose();
        markerListenerDisposable = null;
        decorationsCollection?.clear();
        decorationsCollection = null;
        editor.value?.dispose();
        editor.value = null;

        // Create diff editor (read-only)
        const originalModel = monaco.editor.createModel(loadedValue.value, 'json');
        const modifiedModel = monaco.editor.createModel(currentValue, 'json');

        const diff = monaco.editor.createDiffEditor(editorContainer.value, {
            minimap: { enabled: false },
            automaticLayout: true,
            renderSideBySide: true,
            readOnly: true,
        });
        diff.setModel({ original: originalModel, modified: modifiedModel });
        diffEditor.value = diff;
        showDiff.value = true;
    } else {
        // Switch FROM diff view back to edit
        const de = diffEditor.value;
        const currentValue = de?.getModel()?.modified.getValue() ?? lastCommittedValue.value;

        // Dispose diff editor FIRST, then models (Monaco crashes if models go first)
        const diffModel = de?.getModel();
        de?.dispose();
        diffModel?.original.dispose();
        diffModel?.modified.dispose();
        diffEditor.value = null;

        // Re-create regular editor with the modified value
        await createRegularEditor(currentValue);
        showDiff.value = false;
        nextTick(() => updateEditorHeight());
    }
}

onMounted(async () => {
    const monaco = await import('monaco-editor');
    monacoRef.value = monaco as unknown as MonacoModule;

    // setTheme is global, so this keeps every live editor (regular and diff)
    // in sync with the app theme from here on.
    registerMonacoThemeSetter(monaco.editor.setTheme);

    applySchema(monaco as unknown as MonacoModule, props.schema);

    const initialValue = JSON.stringify(props.modelValue, null, 2);
    await createRegularEditor(initialValue, true);
    if (props.revealIndex != null) {
        await nextTick();
        revealStreamInEditor(props.revealIndex);
    }
});

watch(
    () => props.modelValue,
    (newVal) => {
        const ed = editor.value;
        if (ed && newVal !== undefined) {
            const currentValue = ed.getValue();
            const newValue = JSON.stringify(newVal, null, 2);
            if (currentValue !== newValue) {
                pendingParsedValue = null;
                pendingValueStr = null;
                ed.setValue(newValue);
                lastCommittedValue.value = newValue;
                nextTick(() => updateEditorHeight());
            }
        }
    },
    { deep: true },
);

watch(
    () => props.schema,
    (newSchema) => {
        if (monacoRef.value) {
            applySchema(monacoRef.value, newSchema);
        }
    },
);

watch(
    () => props.revealIndex,
    (newIndex) => {
        if (editor.value && newIndex != null) {
            nextTick(() => revealStreamInEditor(newIndex));
        }
    },
);

onUnmounted(() => {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
    unregisterMonacoThemeSetter();
    markerListenerDisposable?.dispose();
    markerListenerDisposable = null;
    // Dispose diff editor FIRST, then models
    const de = diffEditor.value;
    const diffModel = de?.getModel();
    de?.dispose();
    diffModel?.original.dispose();
    diffModel?.modified.dispose();
    diffEditor.value = null;
    editor.value?.dispose();
});

defineExpose({ isDirty, hasErrors, errorMessages, showDiff, exitDiff, flush: commitPending });

/**
 * Synchronously exit diff mode and switch back to the regular editor.
 * Called from the parent's `canSwitchToVisual` when the user clicks the Visual button while in diff view.
 */
function exitDiff(): void {
    if (!showDiff.value || !monacoRef.value || !editorContainer.value) return;

    const currentValue = diffEditor.value?.getModel()?.modified.getValue() ?? lastCommittedValue.value;

    // Dispose diff editor FIRST, then models (Monaco crashes if models go first)
    const de = diffEditor.value;
    const diffModel = de?.getModel();
    de?.dispose();
    diffModel?.original.dispose();
    diffModel?.modified.dispose();
    diffEditor.value = null;

    // Create regular editor synchronously (monacoRef is already loaded)
    const monaco = monacoRef.value;
    pendingParsedValue = null;
    pendingValueStr = null;
    syntaxError.value = false;

    const ed = monaco.editor.create(editorContainer.value, {
        value: currentValue,
        language: 'json',
        minimap: { enabled: false },
        automaticLayout: true,
        tabSize: 4,
        wordWrap: wordWrapEnabled.value ? 'on' : 'off',
    });

    // Re-attach marker listener
    markerListenerDisposable = monaco.editor.onDidChangeMarkers((resources) => {
        const model = ed.getModel();
        if (!model || !resources.some(r => r.toString() === model.uri.toString())) return;
        validationRev.value++;
        commitPending();
    });

    ed.onDidChangeModelContent(() => {
        contentRev.value++;
        const value = ed.getValue();
        try {
            const parsed = JSON.parse(value);
            syntaxError.value = false;
            pendingParsedValue = parsed;
            pendingValueStr = value;
        } catch {
            syntaxError.value = true;
            pendingParsedValue = null;
            pendingValueStr = null;
        }
        nextTick(() => updateEditorHeight());
        // Auto-commit valid edits even when no marker change fires (valid→valid)
        scheduleSettledCommit();
    });

    editor.value = ed;
    showDiff.value = false;

    // Seed pending state synchronously — no onDidChangeModelContent fires for create()
    try {
        const parsed = JSON.parse(currentValue);
        syntaxError.value = false;
        pendingParsedValue = parsed;
        pendingValueStr = currentValue;
    } catch {
        syntaxError.value = true;
        pendingParsedValue = null;
        pendingValueStr = null;
    }

    nextTick(() => updateEditorHeight());
    // Auto-commit the value restored from diff view once validation settles
    scheduleSettledCommit();
}
</script>

<template>
    <div :class="cn('w-full min-h-0 border rounded-md overflow-hidden relative', props.class)"
        :style="{ height: editorHeight ? editorHeight + 'px' : undefined }">
        <!-- Editor container (content area only) -->
        <div ref="editorContainer" class="w-full" :style="{ height: (editorHeight ? editorHeight - 2 - RESIZE_HANDLE_HEIGHT : 200) + 'px' }" />

        <!-- Resize handle (bottom) -->
        <div
            class="relative flex items-center justify-center h-5 cursor-row-resize select-none
                   bg-accent/30 hover:bg-accent/60 active:bg-accent/80 transition-colors"
            @mousedown.stop="onResizeStart"
        >
            <div class="flex items-center gap-1.5 opacity-40">
                <span class="block w-8 h-px bg-muted-foreground/30"></span>
                <span class="block w-8 h-px bg-muted-foreground/30"></span>
            </div>
        </div>

        <!-- Dropdown trigger button (top-right) -->
        <button
            ref="dropdownTrigger"
            class="absolute top-2 right-2 z-10 inline-flex items-center justify-center w-7 h-7 rounded
                   bg-background/80 hover:bg-accent border border-border/50
                   text-muted-foreground hover:text-foreground transition-colors"
            @click.stop="toggleDropdown"
        >
            <ChevronDown class="w-4 h-4" />
        </button>

        <!-- Dropdown menu -->
        <div
            v-if="dropdownOpen"
            ref="dropdownMenu"
            class="absolute top-10 right-2 z-20 min-w-[200px] rounded-md border bg-popover p-1 shadow-md"
            @click.stop
        >
            <!-- View Changes / Hide Diff toggle -->
            <button
                class="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors text-left"
                @click="toggleDiffView(); closeDropdown()"
            >
                <component :is="showDiff ? EyeOff : Eye" class="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <span>{{ showDiff ? 'Hide Diff' : 'View Changes' }}</span>
            </button>

            <div class="my-1 border-t border-border/50" />

            <!-- Toggle Word Wrap -->
            <button
                class="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors text-left"
                @click="toggleWordWrap()"
            >
                <span class="w-4 h-4 shrink-0 inline-flex items-center justify-center">
                    <Check v-if="wordWrapEnabled" class="w-3.5 h-3.5 text-primary" />
                </span>
                <WrapText class="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <span>Word Wrap</span>
            </button>

            <!-- Toggle Stream Highlight -->
            <button
                class="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors text-left"
                @click="toggleHighlight()"
            >
                <span class="w-4 h-4 shrink-0 inline-flex items-center justify-center">
                    <Check v-if="highlightEnabled" class="w-3.5 h-3.5 text-primary" />
                </span>
                <Highlighter class="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <span>Stream Highlight</span>
            </button>

            <!-- Separator -->
            <div class="my-1 border-t border-border/50" />

            <!-- Copy Highlighted Block -->
            <button
                class="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors text-left"
                :disabled="highlightedRange === null"
                :class="highlightedRange === null ? 'opacity-40 cursor-not-allowed' : ''"
                @click="copyHighlightedBlock()"
            >
                <Copy class="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <span>Copy Highlighted Block</span>
            </button>

            <!-- Copy All JSON -->
            <button
                class="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors text-left"
                @click="copyAllJson()"
            >
                <Copy class="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <span>Copy All JSON</span>
            </button>
        </div>
    </div>
</template>

<!-- Non-scoped styles for Monaco decoration classes (Monaco renders these on internal elements) -->
<style>
.monaco-stream-highlight {
    background-color: rgba(250, 204, 21, 0.12) !important;
}

.monaco-stream-gutter-marker {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: #eab308;
}

.monaco-stream-gutter-marker::before {
    content: '▶';
    font-size: 10px;
}
</style>
