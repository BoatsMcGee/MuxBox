import { defineStore } from 'pinia';
import { ref, onMounted } from 'vue';
import { getSettings, saveSettings } from '@app/preload';
import type { Multiplexer } from '@app/preload';
import { type ThemeMode } from '@app/settings';

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
}

export const useSettingsStore = defineStore('settings', () => {
    const tmdbAccessToken = ref('');
    const theme = ref<ThemeMode>('auto');
    const multiplexerMethod = ref<Multiplexer>({ keepNegativePackets: false, clipTimestamps: false });
    const muxingConcurrency = ref<number | undefined>(undefined);
    const loaded = ref(false);

    async function load(): Promise<void> {
        if (loaded.value) return;
        const settings = await getSettings();
        tmdbAccessToken.value = settings.tmdbAccessToken;
        theme.value = settings.theme;
        if (settings.multiplexerMethod) {
            multiplexerMethod.value = settings.multiplexerMethod;
        }
        muxingConcurrency.value = settings.muxingConcurrency;
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
        loaded,
        load,
        setTmdbToken,
        setTheme,
        setMultiplexerMethod,
        setMuxingConcurrency,
    };
});
