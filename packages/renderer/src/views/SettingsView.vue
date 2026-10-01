<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { openDirectoryDialog } from '@app/preload';
import type { Multiplexer, NativeMultiplexer, FFmpegMultiplexer, FieldConfig } from '@app/preload';
import { type ThemeMode } from '@app/settings';
import RenameTemplateModal from '@/components/rename/RenameTemplateModal.vue';

const router = useRouter();
const settingsStore = useSettingsStore();

const token = ref('');
const selectedTheme = ref<ThemeMode>('auto');
const multiplexerMethod = ref<Multiplexer>({ keepNegativePackets: false, clipTimestamps: false });
const muxingConcurrency = ref<number | undefined>(undefined);
const renameTemplate = ref('');
const renameFieldConfig = ref<Record<string, FieldConfig>>({});
const showRenameModal = ref(false);
const saving = ref(false);
const saved = ref(false);

const isNative = computed(() => !('tempDir' in multiplexerMethod.value));
const isFfmpeg = computed(() => 'tempDir' in multiplexerMethod.value);

onMounted(async () => {
    await settingsStore.load();
    token.value = settingsStore.tmdbAccessToken;
    selectedTheme.value = settingsStore.theme;
    multiplexerMethod.value = { ...settingsStore.multiplexerMethod };
    muxingConcurrency.value = settingsStore.muxingConcurrency;
    renameTemplate.value = settingsStore.defaultRenameTemplate;
    renameFieldConfig.value = JSON.parse(JSON.stringify(settingsStore.defaultRenameFieldConfig)) as Record<string, FieldConfig>;
});

function setNative() {
    multiplexerMethod.value = { keepNegativePackets: false, clipTimestamps: false };
}

function setFfmpeg() {
    multiplexerMethod.value = { tempDir: '' };
}

async function browseTempDir() {
    const result = await openDirectoryDialog(
        (multiplexerMethod.value as FFmpegMultiplexer).tempDir || undefined,
    );
    if (result) {
        multiplexerMethod.value = { tempDir: result };
    }
}

async function handleSave() {
    saving.value = true;
    saved.value = false;
    try {
        await settingsStore.setTmdbToken(token.value);
        await settingsStore.setTheme(selectedTheme.value);
        await settingsStore.setMultiplexerMethod(multiplexerMethod.value);
        await settingsStore.setMuxingConcurrency(muxingConcurrency.value);
        await settingsStore.setDefaultRename(renameTemplate.value, renameFieldConfig.value);
        saved.value = true;
        setTimeout(() => { saved.value = false; }, 2000);
    } finally {
        saving.value = false;
    }
}

const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'auto', label: 'Auto' },
];
</script>

<template>
    <div class="flex flex-col min-h-screen">
        <header class="border-b px-4 py-2 flex items-center gap-3">
            <button class="text-sm text-muted-foreground hover:text-foreground" @click="router.back()">
                ← Back
            </button>
            <h1 class="text-base font-semibold">Settings</h1>
        </header>
        <main class="flex-1 p-6">
            <div class="max-w-2xl mx-auto space-y-8">
                <!-- TMDB Access Token -->
                <section class="space-y-4">
                    <h2 class="text-lg font-semibold">TMDB Access Token</h2>
                    <div class="space-y-2">
                        <label class="block text-sm font-medium">API Token</label>
                        <input v-model="token" type="password"
                            class="w-full px-3 py-2 border rounded-md bg-background font-mono text-sm"
                            placeholder="Enter your TMDB API access token..." />
                        <p class="text-xs text-muted-foreground">
                            MuxBox does not include a built-in token. You can get your own personal read token at
                            <a href="https://www.themoviedb.org/settings/api" target="_blank"
                                class="text-primary hover:underline">themoviedb.org</a>.
                        </p>
                    </div>
                </section>

                <!-- Theme -->
                <section class="space-y-4">
                    <h2 class="text-lg font-semibold">Theme</h2>
                    <div class="flex gap-2">
                        <button v-for="opt in themeOptions" :key="opt.value"
                            class="px-4 py-2 text-sm rounded-md border transition-colors" :class="selectedTheme === opt.value
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-background hover:bg-accent'" @click="selectedTheme = opt.value">
                            {{ opt.label }}
                        </button>
                    </div>
                </section>

                <!-- Default Rename Template -->
                <section class="space-y-4">
                    <h2 class="text-lg font-semibold">Default Rename Template</h2>
                    <div class="space-y-2">
                        <label class="block text-sm font-medium">Template for new projects</label>
                        <div class="rounded-md border border-input bg-background px-3 py-2 text-sm">
                            <RenameTemplateModal
                                :open="showRenameModal"
                                :template="renameTemplate"
                                :field-config="renameFieldConfig"
                                @open="showRenameModal = true"
                                @close="showRenameModal = false"
                                @save="(template: string, fieldConfig: Record<string, FieldConfig>) => {
                                    renameTemplate = template;
                                    renameFieldConfig = fieldConfig;
                                    showRenameModal = false;
                                }"
                            />
                        </div>
                        <p class="text-xs text-muted-foreground">
                            New projects copy this template and its field settings when they are created.
                            Projects you already have keep their own template, and changing this later never
                            rewrites them. Edit it on the project page to change an existing project.
                        </p>
                    </div>
                </section>

                <!-- Multiplexer -->
                <section class="space-y-4">
                    <h2 class="text-lg font-semibold">Multiplexer</h2>
                    <div class="space-y-3">
                        <label class="block text-sm font-medium">Method</label>
                        <div class="flex gap-4">
                            <label class="flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="multiplexer-settings"
                                    :checked="isNative"
                                    class="h-4 w-4"
                                    @change="setNative"
                                />
                                <span class="text-sm">Native (NodeAV)</span>
                            </label>
                            <label class="flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="multiplexer-settings"
                                    :checked="isFfmpeg"
                                    class="h-4 w-4"
                                    @change="setFfmpeg"
                                />
                                <span class="text-sm">FFmpeg</span>
                            </label>
                        </div>

                        <!-- Native options -->
                        <div v-if="isNative" class="ml-6 space-y-2">
                            <label class="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    class="h-4 w-4 rounded border-input"
                                    :checked="(multiplexerMethod as NativeMultiplexer).keepNegativePackets ?? false"
                                    @change="multiplexerMethod = { ...(multiplexerMethod as NativeMultiplexer), keepNegativePackets: ($event.target as HTMLInputElement).checked }"
                                />
                                <span class="text-sm">Keep negative packets</span>
                            </label>
                            <label class="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    class="h-4 w-4 rounded border-input"
                                    :checked="(multiplexerMethod as NativeMultiplexer).clipTimestamps ?? false"
                                    @change="multiplexerMethod = { ...(multiplexerMethod as NativeMultiplexer), clipTimestamps: ($event.target as HTMLInputElement).checked }"
                                />
                                <span class="text-sm">Clip timestamps to 0</span>
                            </label>
                        </div>

                        <!-- FFmpeg options -->
                        <div v-if="isFfmpeg" class="ml-6">
                            <label class="block text-sm mb-1">Temp directory</label>
                            <div class="flex gap-2">
                                <input
                                    class="flex-1 px-3 py-2 border rounded-md bg-background text-sm font-mono"
                                    :value="(multiplexerMethod as FFmpegMultiplexer).tempDir"
                                    placeholder="/path/to/temp/dir..."
                                    readonly
                                />
                                <button
                                    class="px-3 py-2 border rounded-md hover:bg-accent text-sm"
                                    @click="browseTempDir"
                                >
                                    Browse
                                </button>
                            </div>
                        </div>

                        <!-- Muxing Concurrency -->
                        <div class="pt-2 border-t border-border">
                            <label class="block text-sm font-medium mb-1">Muxing Concurrency</label>
                            <div class="flex items-center gap-2">
                                <input
                                    type="number"
                                    v-model.number="muxingConcurrency"
                                    min="1"
                                    max="64"
                                    class="w-24 px-3 py-2 border rounded-md bg-background text-sm"
                                    placeholder="Auto"
                                />
                                <span class="text-xs text-muted-foreground">
                                    Max concurrent muxing operations. Leave empty for default (CPU cores − 1).
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- Save -->
                <div class="flex items-center gap-4">
                    <button
                        class="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                        :disabled="saving" @click="handleSave">
                        {{ saving ? 'Saving...' : 'Save Settings' }}
                    </button>
                    <span v-if="saved" class="text-sm text-green-600">Saved!</span>
                </div>
            </div>
        </main>
    </div>
</template>
