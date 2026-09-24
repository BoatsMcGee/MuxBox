<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { searchTmdbSeries, getTmdbSeriesDetails, getCachedTmdbSeries, cacheTmdbSeries } from '@app/preload';
import { type TmdbSearchResult, type TmdbSeriesCache } from '@app/tmdb';
import { Loader2, Search, X } from '@lucide/vue';

const props = defineProps<{
    modelValue: string;
    /** Optional TMDB series ID to load cached data on mount. */
    initialSeriesId?: number;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
    (e: 'select', series: TmdbSeriesCache): void;
    (e: 'clear'): void;
}>();

const query = ref(props.modelValue);
const results = ref<TmdbSearchResult[]>([]);
const loading = ref(false);
const open = ref(false);
const selectedSeries = ref<TmdbSeriesCache | null>(null);
const cached = ref(false);
const pendingSelection = ref(false);

const debouncedSearch = useDebounceFn(async (q: string) => {
    if (!q || q.length < 2) {
        results.value = [];
        return;
    }
    loading.value = true;
    try {
        results.value = await searchTmdbSeries(q);
    } catch {
        results.value = [];
    } finally {
        loading.value = false;
    }
}, 300);

watch(query, (q) => {
    emit('update:modelValue', q);
    // Don't interfere with a pending selection operation
    if (pendingSelection.value) return;
    if (q.length >= 2) {
        open.value = true;
        debouncedSearch(q);
    } else {
        open.value = false;
    }
});

/**
 * Load TMDB series data for the seasons browser without modifying the display name.
 * Called on mount when a persisted tmdbSeriesId exists.
 */
async function loadCachedSeries(seriesId: number) {
    loading.value = true;
    try {
        const cachedData = await getCachedTmdbSeries(seriesId);
        if (cachedData) {
            selectedSeries.value = cachedData;
            cached.value = true;
        } else {
            const details = await getTmdbSeriesDetails(seriesId);
            if (details) {
                await cacheTmdbSeries(seriesId, details);
                selectedSeries.value = details;
                cached.value = false;
            }
        }
    } catch {
        // Failed to fetch
    } finally {
        loading.value = false;
    }
}

const container = ref<HTMLElement | null>(null);

function onDocumentClick(e: MouseEvent) {
    if (container.value && !container.value.contains(e.target as Node)) {
        open.value = false;
    }
}

onMounted(() => {
    document.addEventListener('click', onDocumentClick, true);
    if (props.initialSeriesId) {
        loadCachedSeries(props.initialSeriesId);
    }
});

onUnmounted(() => {
    document.removeEventListener('click', onDocumentClick, true);
});

async function selectResult(result: TmdbSearchResult) {
    pendingSelection.value = true;
    loading.value = true;
    open.value = false;
    results.value = [];
    query.value = result.name;
    emit('update:modelValue', result.name);

    try {
        const cachedData = await getCachedTmdbSeries(result.id);
        if (cachedData) {
            selectedSeries.value = cachedData;
            cached.value = true;
            emit('select', cachedData);
        } else {
            const details = await getTmdbSeriesDetails(result.id);
            await cacheTmdbSeries(result.id, details);
            selectedSeries.value = details;
            cached.value = false;
            emit('select', details);
        }
    } catch {
        // Failed to fetch details
    } finally {
        loading.value = false;
        pendingSelection.value = false;
    }
}

function clearSelection() {
    selectedSeries.value = null;
    cached.value = false;
    query.value = '';
    emit('update:modelValue', '');
    emit('clear');
}

</script>

<template>
    <div ref="container" class="relative">
        <div class="relative">
            <Search class="absolute left-3 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input v-model="query" type="text"
                class="flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-0"
                placeholder="Search for a series on TMDB..." @focus="!pendingSelection && query.length >= 2 && (open = true)" />
            <button v-if="query" class="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                @click="clearSelection">
                <X class="h-4 w-4" />
            </button>
        </div>

        <!-- Dropdown -->
        <div v-if="open && results.length > 0"
            class="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md max-h-60 overflow-y-auto">
            <div v-for="result in results" :key="result.id"
                class="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent" @click="selectResult(result)">
                <div class="min-w-0 flex-1">
                    <div class="text-sm font-medium truncate">{{ result.name }}</div>
                    <div v-if="result.firstAirDate" class="text-xs text-muted-foreground">
                        {{ result.firstAirDate.substring(0, 4) }}
                    </div>
                </div>
            </div>
        </div>

        <!-- Loading indicator -->
        <div v-if="loading && open" class="absolute z-50 mt-1 w-full rounded-md border bg-popover p-3 text-center">
            <Loader2 class="h-4 w-4 animate-spin mx-auto" />
        </div>
    </div>
</template>
