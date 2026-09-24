<script setup lang="ts">
import { cn } from '@/lib/utils';

defineOptions({ name: 'UiBadgedIcon' });

type BadgePosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

interface Props {
    position?: BadgePosition;
    class?: string;
}

const props = withDefaults(defineProps<Props>(), {
    position: 'top-right',
});

/**
 * Position the subicon so it straddles the corner evenly: translate by 50%
 * of its own size so half peeks outside and half overlaps the main icon.
 */
const positionClasses: Record<BadgePosition, string> = {
    'top-right': 'top-0 right-0 -translate-y-1/2 translate-x-1/2',
    'top-left': 'top-0 left-0 -translate-y-1/2 -translate-x-1/2',
    'bottom-right': 'bottom-0 right-0 translate-y-1/2 translate-x-1/2',
    'bottom-left': 'bottom-0 left-0 translate-y-1/2 -translate-x-1/2',
};
</script>

<template>
    <span :class="cn('relative inline-flex shrink-0', props.class)">
        <slot />

        <!-- Sub-icon overlay, proportionally smaller and straddling the corner -->
        <span
            v-if="$slots.subicon"
            class="absolute flex items-center justify-center"
            :class="positionClasses[props.position]"
            style="width: 10px; height: 10px;"
        >
            <slot name="subicon" />
        </span>
    </span>
</template>
