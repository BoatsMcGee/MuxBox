// @vitest-environment jsdom
/**
 * Tests for the default rename template in the settings store.
 *
 * The store owns two things this feature depends on: it must seed the editor
 * with the built-in default when nothing is configured yet, and it must never
 * hand the shared `DEFAULT_RENAME_FIELD_CONFIG` objects to reactive state by
 * reference (a prefix edit in the editor would then rewrite the global default
 * and every project already created from it).
 *
 * `applyTheme` runs on load and touches `document`/`matchMedia`, hence jsdom.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// `vi.hoisted` keeps one stable handle per mock across `vi.resetModules()`.
// Without it each test re-imports a *different* mock instance, so a
// `mockResolvedValue` set by one test leaks into the next.
const mocks = vi.hoisted(() => ({
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
}));

vi.mock('@app/preload', async () => {
    // The real constants, so the test asserts against shipped values.
    const projects = await import('@app/projects');
    return {
        getSettings: mocks.getSettings,
        saveSettings: mocks.saveSettings,
        DEFAULT_RENAME_TEMPLATE: projects.DEFAULT_RENAME_TEMPLATE,
        DEFAULT_RENAME_FIELD_CONFIG: projects.DEFAULT_RENAME_FIELD_CONFIG,
    };
});

vi.mock('@/lib/monaco-theme', () => ({ syncMonacoTheme: vi.fn() }));

beforeAll(() => {
    // jsdom does not implement matchMedia, which applyTheme consults for 'auto'.
    if (!window.matchMedia) {
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation((query: string) => ({
                matches: false,
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            })),
        });
    }
});

beforeEach(() => {
    vi.resetModules();
    mocks.getSettings.mockReset();
    mocks.getSettings.mockResolvedValue({});
    mocks.saveSettings.mockReset();
    mocks.saveSettings.mockResolvedValue({});
    setActivePinia(createPinia());
});

async function loadStore() {
    const { useSettingsStore } = await import('@/stores/useSettingsStore');
    const { DEFAULT_RENAME_TEMPLATE, DEFAULT_RENAME_FIELD_CONFIG } = await import('@app/projects');
    return { store: useSettingsStore(), DEFAULT_RENAME_TEMPLATE, DEFAULT_RENAME_FIELD_CONFIG };
}

// ─── Seeding on load ────────────────────────────────────────────

describe('default rename seeding', () => {
    it('seeds the built-in template when settings have no default', async () => {
        const { store, DEFAULT_RENAME_TEMPLATE } = await loadStore();
        await store.load();
        expect(store.defaultRenameTemplate).toBe(DEFAULT_RENAME_TEMPLATE);
        expect(store.resolvedDefaultRenameTemplate).toBe(DEFAULT_RENAME_TEMPLATE);
    });

    it('seeds the built-in field config when settings have no default', async () => {
        const { store, DEFAULT_RENAME_FIELD_CONFIG } = await loadStore();
        await store.load();
        expect(store.defaultRenameFieldConfig).toEqual(DEFAULT_RENAME_FIELD_CONFIG);
    });

    it('uses a stored template and field config when present', async () => {
        const { store } = await loadStore();
        mocks.getSettings.mockResolvedValue({
            defaultRenameTemplate: '{{SERIES_NAME}} - {{EPISODE_NAME}}',
            defaultRenameFieldConfig: {
                '{{EPISODE_NAME}}': { prefix: '[', suffix: ']', alwaysAdd: true },
            },
        });

        await store.load();
        expect(store.defaultRenameTemplate).toBe('{{SERIES_NAME}} - {{EPISODE_NAME}}');
        expect(store.defaultRenameFieldConfig).toEqual({
            '{{EPISODE_NAME}}': { prefix: '[', suffix: ']', alwaysAdd: true },
        });
    });

    it('does not alias the shared default field config into reactive state', async () => {
        const { store, DEFAULT_RENAME_FIELD_CONFIG } = await loadStore();
        await store.load();
        // Mutating what the store holds must not reach the module constant.
        store.defaultRenameFieldConfig['{{SEASON_NUMBER}}']!.prefix = 'X';
        expect(DEFAULT_RENAME_FIELD_CONFIG['{{SEASON_NUMBER}}']!.prefix).toBe('S');
    });
});

// ─── Resolved values ────────────────────────────────────────────

describe('resolved default rename', () => {
    it('falls back to the built-in template when the stored one is blank', async () => {
        const { store, DEFAULT_RENAME_TEMPLATE } = await loadStore();
        mocks.getSettings.mockResolvedValue({ defaultRenameTemplate: '   ' });
        await store.load();
        // A cleared Settings field must never seed an empty output filename.
        expect(store.resolvedDefaultRenameTemplate).toBe(DEFAULT_RENAME_TEMPLATE);
    });

    it('falls back to the built-in field config when the stored one is empty', async () => {
        const { store, DEFAULT_RENAME_FIELD_CONFIG } = await loadStore();
        mocks.getSettings.mockResolvedValue({ defaultRenameFieldConfig: {} });
        await store.load();
        expect(store.resolvedDefaultRenameFieldConfig).toEqual(DEFAULT_RENAME_FIELD_CONFIG);
    });

    it('returns a structured-cloneable field config', async () => {
        // Regression: the resolved value is handed straight to createDefaultProjectData
        // and then crosses the IPC bridge in saveProject. A Pinia computed unwraps
        // its value through a reactive proxy, and structuredClone() throws
        // "An object could not be cloned" on a proxy — so project creation failed
        // with no visible error. The computed must hand back plain objects.
        const { store } = await loadStore();
        mocks.getSettings.mockResolvedValue({
            defaultRenameFieldConfig: {
                '{{EPISODE_NAME}}': { prefix: '[', suffix: ']', alwaysAdd: true },
            },
        });
        await store.load();

        const resolved = store.resolvedDefaultRenameFieldConfig;
        expect(() => structuredClone(resolved)).not.toThrow();
        expect(structuredClone(resolved)).toEqual({
            '{{EPISODE_NAME}}': { prefix: '[', suffix: ']', alwaysAdd: true },
        });
    });

    it('returns a cloneable field config for the built-in default too', async () => {
        const { store } = await loadStore();
        await store.load();
        expect(() => structuredClone(store.resolvedDefaultRenameFieldConfig)).not.toThrow();
    });
});

// ─── Saving ─────────────────────────────────────────────────────

describe('setDefaultRename', () => {
    it('persists both halves of the rename default', async () => {
        const { store } = await loadStore();
        await store.load();
        await store.setDefaultRename('{{SERIES_NAME}}', {
            '{{SEASON_NUMBER}}': { prefix: 'S', suffix: '', alwaysAdd: false },
        });

        expect(mocks.saveSettings).toHaveBeenCalledWith({
            defaultRenameTemplate: '{{SERIES_NAME}}',
            defaultRenameFieldConfig: {
                '{{SEASON_NUMBER}}': { prefix: 'S', suffix: '', alwaysAdd: false },
            },
        });
    });

    it('updates the resolved values used for new projects', async () => {
        const { store } = await loadStore();
        await store.load();
        await store.setDefaultRename('{{SERIES_NAME}} - {{EPISODE_NAME}}', {
            '{{EPISODE_NAME}}': { prefix: '', suffix: '', alwaysAdd: false },
        });
        expect(store.resolvedDefaultRenameTemplate).toBe('{{SERIES_NAME}} - {{EPISODE_NAME}}');
        expect(store.resolvedDefaultRenameFieldConfig).toEqual({
            '{{EPISODE_NAME}}': { prefix: '', suffix: '', alwaysAdd: false },
        });
    });

    it('does not pass the reactive field config object straight to saveSettings', async () => {
        const { store } = await loadStore();
        await store.load();
        const passed = {
            '{{SEASON_NUMBER}}': { prefix: 'S', suffix: '', alwaysAdd: false },
        };
        await store.setDefaultRename('{{SERIES_NAME}}', passed);

        const saved = mocks.saveSettings.mock.calls[0]![0] as { defaultRenameFieldConfig: Record<string, { prefix: string }> };
        passed['{{SEASON_NUMBER}}']!.prefix = 'MUTATED';
        expect(saved.defaultRenameFieldConfig['{{SEASON_NUMBER}}']!.prefix).toBe('S');
    });
});
