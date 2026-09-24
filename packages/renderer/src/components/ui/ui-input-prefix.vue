<script setup lang="ts">
import { cn } from '@/lib/utils';

defineOptions({ name: 'UiInputPrefix' });

interface Props {
    class?: string;
    placeholder?: string;
    modelValue?: string;
    disabled?: boolean;
    /** Apply font-mono to the input */
    mono?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    placeholder: '',
    modelValue: '',
    disabled: false,
    mono: false,
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
}>();
</script>

<template>
    <div
        :class="cn(
            'flex items-center rounded-md border border-input bg-background overflow-hidden',
            'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
            props.disabled ? 'cursor-not-allowed opacity-50' : '',
            props.class,
        )"
    >
        <!-- Prefix slot -->
        <slot name="prefix" />

        <input
            :value="props.modelValue"
            :placeholder="props.placeholder"
            :disabled="props.disabled"
            :class="cn(
                'flex-1 min-w-0 bg-transparent outline-none px-1 py-1.5 text-sm',
                'placeholder:text-muted-foreground disabled:cursor-not-allowed',
                props.mono ? 'font-mono' : '',
            )"
            @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        />

        <!-- Suffix slot -->
        <slot name="suffix" />
    </div>
</template>
