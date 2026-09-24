import { ref } from 'vue';

export type ToastVariant = 'default' | 'error' | 'success';

export interface ToastConfig {
    id?: string;
    title: string;
    description?: string;
    /** @default 'foreground' */
    type?: 'foreground' | 'background';
    /** Milliseconds before auto-dismiss. Defaults to ToastProvider's duration (5000). */
    duration?: number;
    /** Visual style variant. @default 'default' */
    variant?: ToastVariant;
    /** Internal: managed by v-model:open on ToastRoot */
    open: boolean;
}

// ─── Module-level singleton state ──────────────────────────────
const toasts = ref<ToastConfig[]>([]);
let counter = 0;

/**
 * Singleton composable for showing toast notifications.
 * All callers share the same reactive toast list so Toaster.vue
 * renders them in one place regardless of which component called `show`.
 */
export function useToast() {
    function show(config: Omit<ToastConfig, 'open'>): string {
        const id = config.id ?? `toast-${++counter}`;
        toasts.value.push({ ...config, id, open: true });
        return id;
    }

    function dismiss(id: string) {
        const toast = toasts.value.find(t => t.id === id);
        if (toast) {
            toast.open = false; // triggers Reka close animation
            setTimeout(() => {
                const idx = toasts.value.findIndex(t => t.id === id);
                if (idx >= 0) toasts.value.splice(idx, 1);
            }, 300); // match animation duration
        }
    }

    function showError(title: string, description?: string) {
        return show({ title, description, type: 'foreground', duration: 8000, variant: 'error' });
    }

    function showSuccess(title: string, description?: string) {
        return show({ title, description, type: 'foreground', duration: 4000, variant: 'success' });
    }

    return { toasts, show, dismiss, showError, showSuccess };
}
