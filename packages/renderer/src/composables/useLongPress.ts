import { ref, onUnmounted } from 'vue';

interface UseLongPressOptions {
    /** Delay in milliseconds before the long press is triggered. Default: 400ms */
    delay?: number;
    /** Callback fired when long press is detected */
    onLongPress: () => void;
    /** Optional callback fired when press starts (mouse down / touch start) */
    onPressStart?: () => void;
    /** Optional callback fired when press ends (mouse up / touch end / cancel) */
    onPressEnd?: () => void;
}

/**
 * Composable for handling long press (click and hold) interactions.
 * Works with both mouse and touch events.
 *
 * @param options - Configuration options
 * @returns Event handlers to bind to the target element
 */
export function useLongPress(options: UseLongPressOptions) {
    const { delay = 400, onLongPress, onPressStart, onPressEnd } = options;

    const timeoutId = ref<number | null>(null);
    const isPressing = ref(false);
    const hasLongPressed = ref(false);

    function clearTimeout() {
        if (timeoutId.value) {
            window.clearTimeout(timeoutId.value);
            timeoutId.value = null;
        }
    }

    function startPress() {
        if (isPressing.value) return;
        isPressing.value = true;
        hasLongPressed.value = false;
        onPressStart?.();

        timeoutId.value = window.setTimeout(() => {
            hasLongPressed.value = true;
            onLongPress();
        }, delay);
    }

    function endPress() {
        if (!isPressing.value) return;
        isPressing.value = false;
        clearTimeout();
        onPressEnd?.();
    }

    function cancelPress() {
        if (!isPressing.value) return;
        isPressing.value = false;
        clearTimeout();
        onPressEnd?.();
    }

    // Mouse handlers
    function onMouseDown(e: MouseEvent) {
        // Ignore right-click and middle-click
        if (e.button !== 0) return;
        // Ignore if clicking on interactive elements (buttons, inputs, etc.)
        const target = e.target as HTMLElement;
        if (target.closest('button, input, select, textarea, a, [role="button"]')) return;
        startPress();
    }

    function onMouseUp() {
        endPress();
    }

    function onMouseLeave() {
        cancelPress();
    }

    // Touch handlers
    function onTouchStart(e: TouchEvent) {
        // Ignore if touching interactive elements
        const target = e.target as HTMLElement;
        if (target.closest('button, input, select, textarea, a, [role="button"]')) return;
        startPress();
    }

    function onTouchEnd() {
        endPress();
    }

    function onTouchCancel() {
        cancelPress();
    }

    // Cleanup on unmount
    onUnmounted(() => {
        clearTimeout();
    });

    return {
        /** Whether a long press is currently in progress (after delay) */
        hasLongPressed,
        /** Whether the pointer is currently down */
        isPressing,
        /** Mouse event handlers */
        onMouseDown,
        onMouseUp,
        onMouseLeave,
        /** Touch event handlers */
        onTouchStart,
        onTouchEnd,
        onTouchCancel,
    };
}