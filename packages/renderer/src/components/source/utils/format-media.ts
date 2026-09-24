/**
 * Shared media formatting utilities.
 * Single source of truth for bitrate, duration, and file size formatting.
 */

export function formatBitrate(bitrate: unknown): string {
    if (typeof bitrate === 'number') {
        if (bitrate >= 1000000) return `${(bitrate / 1000000).toFixed(1)} Mbps`;
        if (bitrate >= 1000) return `${(bitrate / 1000).toFixed(0)} kbps`;
        return `${bitrate} bps`;
    }
    return String(bitrate ?? '—');
}

export function formatDuration(duration: unknown): string {
    if (typeof duration === 'number') {
        const mins = Math.floor(duration / 60);
        const secs = Math.floor(duration % 60);
        return `${mins}:${String(secs).padStart(2, '0')}`;
    }
    return String(duration ?? '—');
}

export function formatFileSize(bytes: number): string {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GiB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MiB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
    return `${bytes} B`;
}
