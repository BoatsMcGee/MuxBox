<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useRouter, RouterView } from 'vue-router';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { TooltipProvider, ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport, ScrollAreaCorner } from 'reka-ui';
import Toaster from '@/components/ui/Toaster.vue';

const settingsStore = useSettingsStore();
const router = useRouter();

function onMouseUp(e: MouseEvent) {
    if (e.button === 3) {
        router.back();
    } else if (e.button === 4) {
        router.forward();
    }
}

onMounted(() => {
    settingsStore.load();
    document.addEventListener('mouseup', onMouseUp);
});

onUnmounted(() => {
    document.removeEventListener('mouseup', onMouseUp);
});
</script>

<template>
    <TooltipProvider>
        <ScrollAreaRoot class="h-screen bg-background text-foreground overflow-hidden" type="always">
            <ScrollAreaViewport class="h-full">
                <div>
                    <RouterView />
                    <Toaster />
                </div>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar orientation="vertical" class="group w-2.5 bg-muted/20">
                <ScrollAreaThumb class="bg-muted-foreground/50 group-hover:bg-muted-foreground/80 rounded-full transition-colors" />
            </ScrollAreaScrollbar>
            <ScrollAreaCorner />
        </ScrollAreaRoot>
    </TooltipProvider>
</template>
