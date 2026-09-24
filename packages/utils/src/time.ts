/**
 * Format milliseconds to a human-readable time string.
 * Returns MM:SS for durations under 1 hour, HH:MM:SS for 1 hour or more.
 */
export function formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parse time string in format "HH:MM:SS.ss" or "MM:SS.ss" to seconds
 */
export function parseTimeToSeconds(timeStr: string): number {
    const match = timeStr.match(/(\d+):(\d+):(\d+)\.(\d+)/);
    if (!match) {
        // Try MM:SS.ss format
        const shortMatch = timeStr.match(/(\d+):(\d+)\.(\d+)/);
        if (shortMatch) {
            const minutes = parseInt(shortMatch[1]!, 10);
            const seconds = parseInt(shortMatch[2]!, 10);
            const centiseconds = parseInt(shortMatch[3]!, 10);
            return minutes * 60 + seconds + centiseconds / 100;
        }
        return 0;
    }
    const hours = parseInt(match[1]!, 10);
    const minutes = parseInt(match[2]!, 10);
    const seconds = parseInt(match[3]!, 10);
    const centiseconds = parseInt(match[4]!, 10);
    return hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
}
