import { defineStore } from 'pinia';
import { ref, computed, onMounted } from 'vue';
import { getSettings, saveSettings, DEFAULT_RENAME_TEMPLATE, DEFAULT_RENAME_FIELD_CONFIG } from '@app/preload';
import type { Multiplexer, FieldConfig } from '@app/preload';
import { type ThemeMode } from '@app/settings';
import { syncMonacoTheme } from '@/lib/monaco-theme';

/**
 * Copy a field config one level deeper than a spread.
 * The per-tag `FieldConfig` objects are shared with the settings store and the
 * module-level default, so neither may be handed to reactive state by
 * reference — a later prefix/padding edit would rewrite the global default.
 */
function cloneFieldConfig(config: Record<string, FieldConfig>): Record<string, FieldConfig> {
    return Object.fromEntries(
        Object.entries(config).map(([tag, cfg]) => [tag, { ...cfg }]),
    );
}

function applyTheme(theme: ThemeMode): void {
    const root = document.documentElement;
    if (theme === 'dark') {
        root.classList.add('dark');
    } else if (theme === 'light') {
        root.classList.remove('dark');
    } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
    }
    // The .dark class is the single source of truth, so push the matching
    // Monaco theme from here too. Every caller (load, setTheme, and the
    // prefers-color-scheme listener for 'auto') goes through this function.
    syncMonacoTheme();
}

export const useSettingsStore = defineStore('settings', () => {
    const tmdbAccessToken = ref('');
    const theme = ref<ThemeMode>('auto');
    const multiplexerMethod = ref<Multiplexer>({ keepNegativePackets: false, clipTimestamps: false });
    const muxingConcurrency = ref<number | undefined>(undefined);
    const defaultRenameTemplate = ref<string>('');
    const defaultRenameFieldConfig = ref<Record<string, FieldConfig>>({});
    const loaded = ref(false);

    /**
     * The rename template a new project actually starts with.
     * A blank configured template falls back to the built-in default so a
     * cleared Settings field can never produce an empty output filename.
     */
    const resolvedDefaultRenameTemplate = computed(() =>
        defaultRenameTemplate.value.trim() ? defaultRenameTemplate.value : DEFAULT_RENAME_TEMPLATE,
    );

    /**
     * The field config a new project actually starts with.
     *
     * Returns a deep copy on purpose. A Pinia computed unwraps its value
     * through a reactive proxy, and that proxy cannot be structured-cloned —
     * handing it straight to `saveProject` throws "An object could not be
     * cloned" and the project is never created. Callers pass this straight into
     * project data that crosses the IPC bridge, so it must be plain.
     */
    const resolvedDefaultRenameFieldConfig = computed(() => {
        const config = Object.keys(defaultRenameFieldConfig.value).length
            ? defaultRenameFieldConfig.value
            : DEFAULT_RENAME_FIELD_CONFIG;
        return cloneFieldConfig(config);
    });

    async function load(): Promise<void> {
        if (loaded.value) return;
        const settings = await getSettings();
        tmdbAccessToken.value = settings.tmdbAccessToken;
        theme.value = settings.theme;
        if (settings.multiplexerMethod) {
            multiplexerMethod.value = settings.multiplexerMethod;
        }
        muxingConcurrency.value = settings.muxingConcurrency;
        // Seed the editor with the built-in default so the very first visit
        // shows a usable template instead of an empty box.
        defaultRenameTemplate.value = settings.defaultRenameTemplate?.trim()
            ? settings.defaultRenameTemplate
            : DEFAULT_RENAME_TEMPLATE;
        defaultRenameFieldConfig.value = settings.defaultRenameFieldConfig
            ? cloneFieldConfig(settings.defaultRenameFieldConfig)
            : cloneFieldConfig(DEFAULT_RENAME_FIELD_CONFIG);
        applyTheme(theme.value);
        loaded.value = true;
    }

    async function setTmdbToken(token: string): Promise<void> {
        tmdbAccessToken.value = token;
        await saveSettings({ tmdbAccessToken: token });
    }

    async function setTheme(newTheme: ThemeMode): Promise<void> {
        theme.value = newTheme;
        applyTheme(newTheme);
        await saveSettings({ theme: newTheme });
    }

    async function setMultiplexerMethod(method: Multiplexer): Promise<void> {
        multiplexerMethod.value = method;
        // Remove Vue reactive proxy
        await saveSettings({ multiplexerMethod: { ...method } });
    }

    async function setMuxingConcurrency(concurrency: number | undefined): Promise<void> {
        muxingConcurrency.value = concurrency;
        await saveSettings({ muxingConcurrency: concurrency });
    }

    async function setDefaultRename(
        template: string,
        fieldConfig: Record<string, FieldConfig>,
    ): Promise<void> {
        defaultRenameTemplate.value = template;
        defaultRenameFieldConfig.value = fieldConfig;
        // Remove Vue reactive proxy
        await saveSettings({
            defaultRenameTemplate: template,
            defaultRenameFieldConfig: cloneFieldConfig(fieldConfig),
        });
    }

    onMounted(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', () => {
            if (theme.value === 'auto') {
                applyTheme('auto');
            }
        });
    });

    return {
        tmdbAccessToken,
        theme,
        multiplexerMethod,
        muxingConcurrency,
        defaultRenameTemplate,
        defaultRenameFieldConfig,
        resolvedDefaultRenameTemplate,
        resolvedDefaultRenameFieldConfig,
        loaded,
        load,
        setTmdbToken,
        setTheme,
        setMultiplexerMethod,
        setMuxingConcurrency,
        setDefaultRename,
    };
});
