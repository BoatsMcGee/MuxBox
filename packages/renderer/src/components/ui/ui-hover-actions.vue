<script setup lang="ts">
defineOptions({ name: 'UiHoverActions' });
</script>

<template>
    <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
        <slot />
    </div>
</template>
