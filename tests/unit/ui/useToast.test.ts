import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each test resets the module so the singleton toast list starts fresh.
beforeEach(() => {
    vi.resetModules();
});

// ─── show / dismiss ────────────────────────────────────────

describe('show / dismiss', () => {
    it('show() appends a toast with open=true and assigns an id', async () => {
        const { useToast } = await import('@/components/ui/useToast');
        const { toasts, show } = useToast();

        expect(toasts.value).toHaveLength(0);

        const id = show({ title: 'Hello' });
        expect(toasts.value).toHaveLength(1);
        expect(toasts.value[0].title).toBe('Hello');
        expect(toasts.value[0].open).toBe(true);
        expect(toasts.value[0].id).toBe(id);
    });

    it('dismiss() sets open=false then removes the toast after 300ms', async () => {
        vi.useFakeTimers();
        const { useToast } = await import('@/components/ui/useToast');
        const { toasts, show, dismiss } = useToast();

        const id = show({ title: 'Test' });
        expect(toasts.value[0].open).toBe(true);

        dismiss(id);
        expect(toasts.value[0].open).toBe(false);
        expect(toasts.value).toHaveLength(1); // still in list during close animation

        vi.advanceTimersByTime(300);
        expect(toasts.value).toHaveLength(0); // removed after animation

        vi.useRealTimers();
    });

    it('dismiss() is a no-op for an unknown id', async () => {
        const { useToast } = await import('@/components/ui/useToast');
        const { toasts, show, dismiss } = useToast();

        show({ title: 'Test' });
        dismiss('nonexistent');
        expect(toasts.value).toHaveLength(1);
    });
});

// ─── showError / showSuccess ───────────────────────────────

describe('showError / showSuccess', () => {
    it('showError() sets variant=error, duration=8000, type=foreground', async () => {
        const { useToast } = await import('@/components/ui/useToast');
        const { toasts, showError } = useToast();

        showError('Something broke', 'Stack trace here');
        expect(toasts.value[0].title).toBe('Something broke');
        expect(toasts.value[0].description).toBe('Stack trace here');
        expect(toasts.value[0].variant).toBe('error');
        expect(toasts.value[0].duration).toBe(8000);
        expect(toasts.value[0].type).toBe('foreground');
    });

    it('showSuccess() sets variant=success, duration=4000, type=foreground', async () => {
        const { useToast } = await import('@/components/ui/useToast');
        const { toasts, showSuccess } = useToast();

        showSuccess('Done!', 'Operation completed');
        expect(toasts.value[0].title).toBe('Done!');
        expect(toasts.value[0].description).toBe('Operation completed');
        expect(toasts.value[0].variant).toBe('success');
        expect(toasts.value[0].duration).toBe(4000);
        expect(toasts.value[0].type).toBe('foreground');
    });
});

// ─── Singleton behaviour ───────────────────────────────────

describe('singleton behaviour', () => {
    it('multiple useToast() calls share the same reactive list', async () => {
        const mod = await import('@/components/ui/useToast');
        const a = mod.useToast();
        const b = mod.useToast();

        expect(a.toasts).toBe(b.toasts); // same ref instance

        a.show({ title: 'From A' });
        expect(b.toasts.value).toHaveLength(1);
        expect(b.toasts.value[0].title).toBe('From A');
    });

    it('toast order is preserved (FIFO)', async () => {
        const { useToast } = await import('@/components/ui/useToast');
        const { toasts, show } = useToast();

        show({ title: 'First' });
        show({ title: 'Second' });
        show({ title: 'Third' });

        expect(toasts.value.map(t => t.title)).toEqual(['First', 'Second', 'Third']);
    });
});
