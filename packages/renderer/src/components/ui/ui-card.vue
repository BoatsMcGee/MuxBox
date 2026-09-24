<script setup lang="ts">
import { cn } from '@/lib/utils';

defineOptions({ name: 'UiCard' });

interface Props {
    class?: string;
}

const props = defineProps<Props>();
</script>

<template>
    <div
        :class="cn(
            'rounded-lg border bg-card text-card-foreground shadow-sm',
            props.class,
        )"
    >
        <slot />
    </div>
</template>
