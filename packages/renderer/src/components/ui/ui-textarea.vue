<script setup lang="ts">
import { cn } from '@/lib/utils';

defineOptions({ name: 'UiTextarea' });

interface Props {
    class?: string;
    placeholder?: string;
    value?: string;
    disabled?: boolean;
    rows?: number;
}

const props = withDefaults(defineProps<Props>(), {
    placeholder: '',
    value: '',
    disabled: false,
    rows: 3,
});

const emit = defineEmits<{
    (e: 'input', event: Event): void;
}>();
</script>

<template>
    <textarea
        :placeholder="props.placeholder"
        :value="props.value"
        :disabled="props.disabled"
        :rows="props.rows"
        :class="cn(
            'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            props.class,
        )"
        @input="emit('input', $event)"
    />
</template>
