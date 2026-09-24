<script setup lang="ts">
import { cn } from '@/lib/utils';

defineOptions({ name: 'UiInput' });

interface Props {
    class?: string;
    type?: string;
    placeholder?: string;
    value?: string;
    disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    type: 'text',
    placeholder: '',
    value: '',
    disabled: false,
});

const emit = defineEmits<{
    (e: 'input', event: Event): void;
}>();
</script>

<template>
    <input
        :type="props.type"
        :placeholder="props.placeholder"
        :value="props.value"
        :disabled="props.disabled"
        :class="cn(
            'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            props.class,
        )"
        @input="emit('input', $event)"
    />
</template>
