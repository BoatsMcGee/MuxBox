/**
 * Shared FFmpeg concurrency semaphore.
 * Demuxer.open() calls FFmpeg's avformat_open_input internally, which
 * deadlocks when >= 7 calls happen simultaneously due to contention on
 * avformat's global state. This semaphore serializes opens to 1 at a time.
 *
 * This is the single shared instance used by both @app/muxer and @app/preload
 * to coordinate all Demuxer.open() calls across the application.
 */

const ffmpegInitQueue: Array<() => void> = [];
let ffmpegInitInProgress = false;

export async function acquireFfmpegSemaphore(): Promise<void> {
    if (!ffmpegInitInProgress) {
        ffmpegInitInProgress = true;
        return;
    }
    return new Promise<void>(resolve => {
        ffmpegInitQueue.push(resolve);
    });
}

export function releaseFfmpegSemaphore(): void {
    const next = ffmpegInitQueue.shift();
    if (next) {
        next();
    } else {
        ffmpegInitInProgress = false;
    }
}
