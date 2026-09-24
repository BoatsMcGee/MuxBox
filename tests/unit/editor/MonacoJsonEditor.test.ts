// @vitest-environment jsdom
//
// These tests mount MonacoJsonEditor in a simulated DOM (jsdom) with a
// lightweight Monaco mock.  We control markers, content changes, and editor
// lifecycle deterministically — no real web workers, no async latency.
//
// Required: jsdom (npm install -D jsdom)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import MonacoJsonEditor from '@/components/editor/MonacoJsonEditor.vue';
import { nextTick } from 'vue';

// ─── Monaco mock ─────────────────────────────────────────

let contentChangeHandler: ((() => void) | null) = null;
let markerListener: ((resources: { toString: () => string }[]) => void) | null = null;
const mockMarkers: { startLineNumber: number; startColumn: number; message: string; severity: number }[] = [];

function freshEditorStub() {
    contentChangeHandler = null;
    return {
        getValue: vi.fn(() => ''),
        setValue: vi.fn(),
        getModel: vi.fn(() => ({
            uri: { toString: () => 'file:///test.json' },
            getLineCount: () => 1,
            getLineContent: () => '',
        })),
        onDidChangeModelContent: vi.fn((h: () => void) => { contentChangeHandler = h; }),
        dispose: vi.fn(),
        updateOptions: vi.fn(),
        createDecorationsCollection: vi.fn(() => ({ clear: vi.fn() })),
        revealLineNearTop: vi.fn(),
        setPosition: vi.fn(),
    };
}

let currentEditor: ReturnType<typeof freshEditorStub>;

vi.mock('monaco-editor', () => ({
    editor: {
        create: vi.fn((_container: HTMLElement, opts?: { value?: string }) => {
            currentEditor = freshEditorStub();
            currentEditor.getValue.mockReturnValue(opts?.value ?? '');
            return currentEditor;
        }),
        createModel: vi.fn(() => ({ dispose: vi.fn(), getValue: () => '' })),
        createDiffEditor: vi.fn(() => ({
            setModel: vi.fn(),
            getModel: vi.fn(() => ({
                original: { dispose: vi.fn() },
                modified: { dispose: vi.fn(), getValue: () => '' },
            })),
            dispose: vi.fn(),
            updateOptions: vi.fn(),
        })),
        getModelMarkers: vi.fn(() => mockMarkers),
        onDidChangeMarkers: vi.fn((l: (r: { toString: () => string }[]) => void) => {
            markerListener = l;
            return { dispose: vi.fn() };
        }),
    },
    Range: class {},
    languages: {
        json: {
            jsonDefaults: {
                setDiagnosticsOptions: vi.fn(),
            },
        },
    },
}));

// ─── Helpers ──────────────────────────────────────────────

/** Wait for the component's async onMounted to settle (takes multiple microtask cycles). */
async function waitForMount(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 0));
    }
}

/** Simulate typing new content: set the editor value and fire the content change handler. */
function setContent(rawJson: string): void {
    currentEditor.getValue.mockReturnValue(rawJson);
    contentChangeHandler?.();
}

/** Simulate Monaco markers arriving for the current model. */
function fireMarkers(): void {
    markerListener?.([{ toString: () => 'file:///test.json' }]);
}

// ─── Tests ────────────────────────────────────────────────

describe('MonacoJsonEditor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMarkers.length = 0;
        contentChangeHandler = null;
        markerListener = null;
    });

    describe('initial state', () => {
        it('mounts clean — isDirty=false, hasErrors=false, showDiff=false', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: { a: 1 } },
            });
            await waitForMount();

            expect(w.vm.isDirty).toBe(false);
            expect(w.vm.hasErrors).toBe(false);
            expect(w.vm.showDiff).toBe(false);
            expect(w.vm.errorMessages).toEqual([]);
        });
    });

    describe('syntax errors', () => {
        it('hasErrors=true immediately for unparseable JSON (no markers needed)', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: {} },
            });
            await waitForMount();

            setContent('{ broken');

            expect(w.vm.hasErrors).toBe(true);
            expect(w.emitted('update:modelValue')).toBeFalsy();
        });

        it('recovers when content is fixed and markers confirm it is clean', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: {} },
            });
            await waitForMount();

            setContent('{ broken');
            expect(w.vm.hasErrors).toBe(true);

            setContent('{ "ok": 1 }');
            fireMarkers();
            await nextTick();

            expect(w.vm.hasErrors).toBe(false);
            expect(w.emitted('update:modelValue')).toBeTruthy();
        });
    });

    describe('schema errors', () => {
        it('hasErrors=true + errorMessages when markers report schema violations', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: {}, schema: { type: 'object' } },
            });
            await waitForMount();

            setContent('{ "bad": true }');

            mockMarkers.push({
                startLineNumber: 1,
                startColumn: 3,
                message: 'Property "bad" is not allowed',
                severity: 8,
            });
            fireMarkers();
            await nextTick();

            expect(w.vm.hasErrors).toBe(true);
            expect(w.vm.errorMessages[0]).toContain('not allowed');
            expect(w.emitted('update:modelValue')).toBeFalsy();
        });

        it('emits once schema errors clear', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: {} },
            });
            await waitForMount();

            setContent('{ "good": 1 }');
            fireMarkers();
            await nextTick();

            expect(w.emitted('update:modelValue')).toBeTruthy();
        });
    });

    describe('dirty tracking', () => {
        it('isDirty=true after content change', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: { orig: 1 } },
            });
            await waitForMount();
            expect(w.vm.isDirty).toBe(false);

            setContent('{ "changed": 1 }');
            expect(w.vm.isDirty).toBe(true);
        });

        it('isDirty=false after value is committed (emitted + markers clear)', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: { orig: 1 } },
            });
            await waitForMount();

            setContent('{ "changed": 1 }');
            expect(w.vm.isDirty).toBe(true);

            fireMarkers();
            await nextTick();

            expect(w.vm.isDirty).toBe(false);
        });
    });

    describe('settled-validation auto-commit (valid → valid)', () => {
        it('emits update:modelValue even when no marker change fires', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: { width: 1920 } },
            });
            await waitForMount();

            vi.useFakeTimers();
            try {
                // Valid → valid edit: markers never change, so onDidChangeMarkers
                // never fires. The settled-commit timer must emit the value.
                setContent('{ "width": 1280 }');
                expect(w.emitted('update:modelValue')).toBeFalsy();

                vi.advanceTimersByTime(2000);
                await nextTick();

                expect(w.emitted('update:modelValue')).toBeTruthy();
                expect(w.emitted('update:modelValue')![0][0]).toEqual({ width: 1280 });
                expect(w.vm.isDirty).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });

        it('does not emit while markers report schema errors', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: {}, schema: { type: 'object' } },
            });
            await waitForMount();

            vi.useFakeTimers();
            try {
                setContent('{ "bad": true }');
                mockMarkers.push({
                    startLineNumber: 1,
                    startColumn: 3,
                    message: 'Property "bad" is not allowed',
                    severity: 8,
                });
                fireMarkers();
                await nextTick();

                vi.advanceTimersByTime(400);
                await nextTick();

                expect(w.emitted('update:modelValue')).toBeFalsy();
                expect(w.vm.hasErrors).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        });

        it('does not emit for unparseable JSON', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: {} },
            });
            await waitForMount();

            vi.useFakeTimers();
            try {
                setContent('{ broken');
                vi.advanceTimersByTime(400);
                await nextTick();

                expect(w.emitted('update:modelValue')).toBeFalsy();
                expect(w.vm.hasErrors).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('flush', () => {
        it('commits a pending valid value synchronously without any marker event', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: { width: 1920 } },
            });
            await waitForMount();

            setContent('{ "width": 1280 }');
            expect(w.emitted('update:modelValue')).toBeFalsy();

            w.vm.flush();
            await nextTick();

            expect(w.emitted('update:modelValue')).toBeTruthy();
            expect(w.emitted('update:modelValue')![0][0]).toEqual({ width: 1280 });
            expect(w.vm.isDirty).toBe(false);
        });

        it('is a no-op when the editor has schema errors', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: {}, schema: { type: 'object' } },
            });
            await waitForMount();

            setContent('{ "bad": true }');
            mockMarkers.push({
                startLineNumber: 1,
                startColumn: 3,
                message: 'Property "bad" is not allowed',
                severity: 8,
            });
            fireMarkers();
            await nextTick();

            w.vm.flush();
            await nextTick();

            expect(w.emitted('update:modelValue')).toBeFalsy();
            expect(w.vm.hasErrors).toBe(true);
        });
    });

    describe('exitDiff race condition', () => {
        it('syntaxError catches unparseable JSON synchronously, before markers arrive', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: { valid: 1 } },
            });
            await waitForMount();

            setContent('{ broken');

            // No fireMarkers() — syntaxError ref must bridge the async gap
            expect(w.vm.hasErrors).toBe(true);
        });
    });

    describe('external modelValue push', () => {
        it('calls setValue when parent pushes new data', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: { a: 1 } },
            });
            await waitForMount();

            await w.setProps({ modelValue: { b: 2 } });

            expect(currentEditor.setValue).toHaveBeenCalledWith(
                expect.stringContaining('"b"'),
            );
        });
    });

    describe('cleanup', () => {
        it('disposes editor on unmount', async () => {
            const w = mount(MonacoJsonEditor, {
                props: { modelValue: {} },
            });
            await waitForMount();

            w.unmount();
            expect(currentEditor.dispose).toHaveBeenCalled();
        });
    });
});
