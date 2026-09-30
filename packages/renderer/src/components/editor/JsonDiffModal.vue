<script setup lang="ts">
import { ref, onMounted, shallowRef, onUnmounted, nextTick } from 'vue';
import { DialogRoot, DialogContent, DialogTitle, DialogClose } from 'reka-ui';
import { X } from '@lucide/vue';
import { registerMonacoThemeSetter, unregisterMonacoThemeSetter } from '@/lib/monaco-theme';

interface Props {
    open: boolean;
    original: string;
    modified: string;
    title?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
    (e: 'update:open', value: boolean): void;
}>();

const diffContainer = ref<HTMLDivElement | null>(null);
const diffEditor = shallowRef<unknown>(null);

onMounted(async () => {
    await nextTick();
    if (!diffContainer.value) return;

    const monaco = await import('monaco-editor');

    // setTheme is global, so this keeps the diff editor in sync with the app theme.
    registerMonacoThemeSetter(monaco.editor.setTheme);

    const originalModel = monaco.editor.createModel(props.original, 'json');
    const modifiedModel = monaco.editor.createModel(props.modified, 'json');

    const editor = monaco.editor.createDiffEditor(diffContainer.value, {
        minimap: { enabled: false },
        automaticLayout: true,
        renderSideBySide: true,
        readOnly: true,
    });

    editor.setModel({ original: originalModel, modified: modifiedModel });
    diffEditor.value = editor;
});

onUnmounted(() => {
    unregisterMonacoThemeSetter();

    if (diffEditor.value) {
        const de = diffEditor.value as {
            getModel: () => { original: { dispose: () => void }; modified: { dispose: () => void } } | null;
            dispose: () => void;
        };
        const model = de.getModel();
        if (model) {
            model.original.dispose();
            model.modified.dispose();
        }
        de.dispose();
    }
});
</script>

<template>
    <DialogRoot :open="props.open" @update:open="(v) => emit('update:open', v)">
        <DialogContent
            class="fixed left-1/2 top-1/2 z-50 grid w-full max-w-[90vw] max-h-[85vh] gap-4 border bg-background p-6 shadow-lg sm:rounded-lg -translate-x-1/2 -translate-y-1/2"
        >
            <div class="flex items-center justify-between">
                <DialogTitle class="text-sm font-semibold">
                    {{ title ?? 'JSON Changes' }}
                </DialogTitle>
                <DialogClose
                    class="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                    <X class="w-4 h-4" />
                </DialogClose>
            </div>
            <div ref="diffContainer" class="w-full min-h-[400px] flex-1 border rounded-md overflow-hidden" />
        </DialogContent>
    </DialogRoot>
</template>
