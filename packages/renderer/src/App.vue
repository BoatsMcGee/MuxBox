<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRouter, RouterView } from 'vue-router';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { TooltipProvider, ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport, ScrollAreaCorner } from 'reka-ui';
import Toaster from '@/components/ui/Toaster.vue';

const settingsStore = useSettingsStore();
const router = useRouter();

/**
 * The root ScrollArea uses `type="always"`, which renders the scrollbar track
 * unconditionally. Its thumb's own `data-state` cannot be used to hide it:
 * Reka derives that state from a ratio that stays inside (0,1) for
 * non-overflowing content, so it reports "visible" even at zero overflow.
 * Measure the overflow directly and v-if the thumb instead.
 */
const canScroll = ref(false);

const VIEWPORT_SELECTOR = '[data-reka-scroll-area-viewport]';

let viewport: HTMLElement | undefined;
let resizeObserver: ResizeObserver | undefined;

function updateOverflow(): void {
    if (!viewport) return;
    canScroll.value = viewport.scrollHeight > viewport.clientHeight;
}

function watchViewport(next: HTMLElement | null | undefined): void {
    resizeObserver?.disconnect();
    viewport?.removeEventListener('scroll', updateOverflow);
    viewport = next ?? undefined;

    if (!viewport) {
        canScroll.value = false;
        return;
    }

    // Watch the scroll box and its content wrapper: the box alone does not
    // resize when a routed view grows (e.g. an expanding episode list).
    resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(viewport);
    const content = viewport.firstElementChild;
    if (content) resizeObserver.observe(content);

    viewport.addEventListener('scroll', updateOverflow, { passive: true });
    updateOverflow();
}

/**
 * ScrollAreaViewport renders a Fragment, so it cannot take a template ref;
 * ScrollAreaRoot does, and exposes the resolved viewport. Reka assigns that
 * viewport in its own onMounted, which runs after this component's, so the ref
 * only ever sees the root element — the viewport is picked up after mount.
 */
function setScrollArea(instance: unknown): void {
    if (typeof instance !== 'object' || instance === null) return;
    const root = Reflect.get(instance, '$el');
    watchViewport(root instanceof HTMLElement ? root.querySelector<HTMLElement>(VIEWPORT_SELECTOR) : undefined);
}

function onMouseUp(e: MouseEvent) {
    if (e.button === 3) {
        router.back();
    } else if (e.button === 4) {
        router.forward();
    }
}

onMounted(async () => {
    settingsStore.load();
    document.addEventListener('mouseup', onMouseUp);
    // Reka assigns the scroll viewport in its own onMounted, which runs after
    // this component's, so resolve it once the children have mounted.
    await nextTick();
    if (!viewport) {
        const root = document.querySelector<HTMLElement>('.h-screen');
        watchViewport(root?.querySelector<HTMLElement>(VIEWPORT_SELECTOR));
    }
    updateOverflow();
});

onUnmounted(() => {
    document.removeEventListener('mouseup', onMouseUp);
    viewport?.removeEventListener('scroll', updateOverflow);
    resizeObserver?.disconnect();
});
</script>

<template>
    <TooltipProvider>
        <ScrollAreaRoot :ref="setScrollArea" class="h-screen bg-background text-foreground overflow-hidden" type="always">
            <ScrollAreaViewport class="h-full">
                <div>
                    <RouterView />
                    <Toaster />
                </div>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar orientation="vertical" class="group w-2.5 bg-muted/20">
                <ScrollAreaThumb v-if="canScroll" class="bg-muted-foreground/50 group-hover:bg-muted-foreground/80 rounded-full transition-colors" />
            </ScrollAreaScrollbar>
            <ScrollAreaCorner />
        </ScrollAreaRoot>
    </TooltipProvider>
</template>
