import fs from 'node:fs/promises';
import { cpus } from 'node:os';
import {
    mediaInfoFactory,
    isTrackType,
    type MediaInfoResult,
    type Track,
    type AudioTrack,
    type TextTrack,
    type VideoTrack,
    type MediaInfo,
} from 'mediainfo.js';

export type MediaInfoTrackMap = Map<number, Track>;

// ─── MediaInfo instance pool ──────────────────────────────────────────
// Creating a MediaInfo instance (~1-2s WASM cold start) on every probe is
// very expensive. We maintain a pool sized to the number of CPU cores so
// multiple files can be probed in parallel without paying the factory cost
// per file.
//
// MediaInfo.analyzeData() uses mutable internal state, so concurrent calls
// on the same instance are not safe. The pool gives each caller exclusive
// access via acquire/release.

const POOL_SIZE = Math.max(1, cpus().length);

/** Instances currently free. */
const free: MediaInfo<'object'>[] = [];

/** Callers waiting for an instance. */
const waiters: Array<(instance: MediaInfo<'object'>) => void> = [];

/** Whether the lazy fill has been started. */
let fillStarted = false;

/**
 * Start all factory creations concurrently (lazily, on first acquire).
 * Each `.then` pushes the ready instance into free (or hands to a waiter).
 * Factory startup is I/O bound (~3s each) and parallelizes well.
 */
function startFill(): void {
    if (fillStarted) return;
    fillStarted = true;
    for (let i = 0; i < POOL_SIZE; i++) {
        mediaInfoFactory({ format: 'object', full: false }).then(mi => {
            const waiter = waiters.shift();
            if (waiter) {
                waiter(mi);
            } else {
                free.push(mi);
            }
        }).catch(() => { /* best-effort */ });
    }
}

/**
 * Acquire an exclusive MediaInfo instance from the pool.
 * Blocks if all instances are in use; returns one when available.
 */
async function acquire(): Promise<MediaInfo<'object'>> {
    startFill();

    const instance = free.pop();
    if (instance) return instance;

    return new Promise(resolve => { waiters.push(resolve); });
}

/**
 * Return an instance to the pool. If someone is waiting, hand it off
 * directly to avoid an extra enqueue/dequeue cycle.
 */
function release(instance: MediaInfo<'object'>): void {
    const waiter = waiters.shift();
    if (waiter) {
        waiter(instance);
    } else {
        free.push(instance);
    }
}

/**
 * Analyzes a media file using MediaInfo to extract stream tracks.
 * Uses a pooled WASM instance to avoid repeated cold starts.
 *
 * @param filePath - Path to the media file to analyze
 * @returns Promise resolving to stream track information
 */
export async function getStreamTracks(filePath: string): Promise<Map<number, Track>> {
    const mi = await acquire();
    let fileHandle: fs.FileHandle | undefined;

    try {
        fileHandle = await fs.open(filePath, 'r');
        const stats = await fileHandle.stat();

        const readChunk = async (size: number, offset: number): Promise<Uint8Array> => {
            const buffer = new Uint8Array(size);
            await fileHandle!.read(buffer, 0, size, offset);
            return buffer;
        };

        mi.reset();
        const result = (await mi.analyzeData(stats.size, readChunk)) as MediaInfoResult;
        const streamTracks = new Map<number, Track>();

        if (!result.media?.track) {
            return streamTracks;
        }

        // MediaInfo track array includes General (container) as first element
        // Store General at index -1 so it's available for raw inspection
        // Video, Audio, Text tracks follow in order starting at index 0
        let streamIndex = 0;
        for (const track of result.media.track) {
            if (isTrackType(track, 'General')) {
                streamTracks.set(-1, track);
                continue;
            }

            streamTracks.set(streamIndex, track);
            streamIndex++;
        }

        return streamTracks;
    } finally {
        await fileHandle?.close();
        release(mi);
    }
}

export function getTrackLanguage(track: Track): Pick<AudioTrack, 'Language_String' | 'Language' | 'Language_String1' | 'Language_String2' | 'Language_String3' | 'Language_String4'> | undefined {
    if (isTrackType(track, 'Audio')) {
        const audioTrack = track as AudioTrack;
        return {
            Language_String: audioTrack.Language_String,
            Language: audioTrack.Language,
            Language_String1: audioTrack.Language_String1,
            Language_String2: audioTrack.Language_String2,
            Language_String3: audioTrack.Language_String3,
            Language_String4: audioTrack.Language_String4,
        };
    } else if (isTrackType(track, 'Text')) {
        const textTrack = track as TextTrack;
        return {
            Language_String: textTrack.Language_String,
            Language: textTrack.Language,
            Language_String1: textTrack.Language_String1,
            Language_String2: textTrack.Language_String2,
            Language_String3: textTrack.Language_String3,
            Language_String4: textTrack.Language_String4,
        };
    } else if (isTrackType(track, 'Video')) {
        const videoTrack = track as VideoTrack;
        return {
            Language_String: videoTrack.Language_String,
            Language: videoTrack.Language,
            Language_String1: videoTrack.Language_String1,
            Language_String2: videoTrack.Language_String2,
            Language_String3: videoTrack.Language_String3,
            Language_String4: videoTrack.Language_String4,
        };
    } else {
        return undefined;
    }
}
