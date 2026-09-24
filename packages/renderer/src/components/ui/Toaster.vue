<script setup lang="ts">
import { ToastProvider, ToastRoot, ToastTitle, ToastDescription, ToastClose, ToastViewport } from 'reka-ui';
import { useToast, type ToastVariant } from './useToast';
import { X, CircleAlert, CircleCheck, Info } from '@lucide/vue';

defineOptions({ name: 'AppToaster' });

const { toasts, dismiss } = useToast();

function iconFor(v: ToastVariant | undefined) {
    switch (v) {
        case 'error': return CircleAlert;
        case 'success': return CircleCheck;
        default: return Info;
    }
}

function borderClassFor(v: ToastVariant | undefined) {
    switch (v) {
        case 'error': return 'border-l-destructive';
        case 'success': return 'border-l-emerald-500';
        default: return 'border-l-primary/40';
    }
}

function iconColorFor(v: ToastVariant | undefined) {
    switch (v) {
        case 'error': return 'text-destructive';
        case 'success': return 'text-emerald-500';
        default: return 'text-primary';
    }
}
</script>

<template>
    <ToastProvider :duration="5000" :swipe-direction="'right'">
        <ToastViewport
            class="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 w-full max-w-[380px] outline-none"
        >
            <ToastRoot
                v-for="toast in toasts"
                :key="toast.id"
                v-model:open="toast.open"
                :duration="toast.duration"
                :type="toast.type ?? 'foreground'"
                :class="[
                    'group relative flex items-start gap-3 rounded-lg border bg-background p-4 shadow-lg border-l-4',
                    borderClassFor(toast.variant),
                    'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-full',
                    'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-full',
                    'data-[swipe=end]:animate-out data-[swipe=end]:fade-out-0 data-[swipe=end]:slide-out-to-right-full',
                    'data-[swipe=cancel]:translate-x-0 transition-[transform] duration-200',
                ]"
                @update:open="(v) => { if (!v) dismiss(toast.id!) }"
            >
                <span class="shrink-0 mt-0.5" :class="iconColorFor(toast.variant)">
                    <component :is="iconFor(toast.variant)" class="w-4 h-4" />
                </span>
                <div class="flex-1 min-w-0">
                    <ToastTitle class="text-sm font-medium text-foreground">
                        {{ toast.title }}
                    </ToastTitle>
                    <ToastDescription v-if="toast.description" class="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                        {{ toast.description }}
                    </ToastDescription>
                </div>
                <ToastClose
                    class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded
                           text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
                >
                    <X class="w-3.5 h-3.5" />
                </ToastClose>
            </ToastRoot>
        </ToastViewport>
    </ToastProvider>
</template>
