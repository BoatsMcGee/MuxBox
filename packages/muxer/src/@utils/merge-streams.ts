import {
    type Packet,
    type Demuxer,
    type Stream,
    Packet as PacketImpl,
    FFmpegError,
    AVERROR_EOF,
    AVERROR_EXIT,
    AVERROR_EAGAIN,
    AV_NOPTS_VALUE,
} from 'node-av';

// #region Types

export interface WriteContext {
    outputIndex: number;
    delaySec: number;
    timeBaseNum: number;
    timeBaseDen: number;
    /**
     * `delaySec` pre-converted to stream time-base units. Loop-invariant, so it
     * is computed once when the context is built rather than allocating a BigInt
     * per packet.
     */
    delayInStreamUnits: bigint;
}

export interface HeapEntry {
    sortDtsUs: number;
    packet: Packet;
    bucket: SyncPacketBucket;
}

/** Plain time-base pair, pre-extracted to avoid per-packet Rational allocation. */
export interface RationalLike {
    readonly num: number;
    readonly den: number;
}

// #endregion Types

// #region Helpers

/**
 * Build the key used to look up a stream in writeContextMap.
 * Preprocessed pipe demuxers have a single stream at index 0.
 */
export function buildWriteKey(demuxerMapKey: string, streamIndex: number): string {
    return demuxerMapKey.includes(':preprocess:')
        ? demuxerMapKey
        : `${demuxerMapKey}:${streamIndex}`;
}

/**
 * Build the key used to look up a stream in outputIndexMap.
 */
export function getStreamKey(demuxerMapKey: string, originalIndex: number): string {
    return demuxerMapKey.includes(':preprocess:')
        ? demuxerMapKey
        : `${demuxerMapKey}:${originalIndex}`;
}

/**
 * Compute a microsecond sort key for a packet's DTS.
 */
export function computeSortDtsUs(packet: Packet): number {
    if (packet.dts === AV_NOPTS_VALUE) return -Infinity;
    const tb = packet.timeBase;
    return Number(packet.dts) * tb.num / tb.den * 1_000_000;
}

// #endregion Helpers

// #region SyncPacketBucket

/**
 * A bucket that buffers packets from one demuxerMapKey before they enter
 * the k-way merge heap. Packets are dispatched to a write-context-mapped
 * output stream when pulled.
 */
export class SyncPacketBucket {
    readonly demuxerMapKey: string;
    private readonly writeContextMap: ReadonlyMap<string, WriteContext>;
    private buffer: Packet[] = [];
    public exhausted = false;
    /**
     * Write keys per stream index, memoized. `buildWriteKey` scans the full
     * absolute source path for ':preprocess:' and concatenates a fresh ~70-char
     * string on every call; this runs once per packet. The stream set is fixed
     * for a bucket's lifetime, so the mapping is stable.
     */
    private readonly keyCache = new Map<number, string | null>();

    constructor(demuxerMapKey: string, writeContextMap: ReadonlyMap<string, WriteContext>) {
        this.demuxerMapKey = demuxerMapKey;
        this.writeContextMap = writeContextMap;
    }

    push(packet: Packet): void {
        this.buffer.push(packet);
    }

    /** Memoized write key for a stream index; null when unmapped. */
    private writeKeyFor(streamIndex: number): string | null {
        const cached = this.keyCache.get(streamIndex);
        if (cached !== undefined) return cached;
        const key = buildWriteKey(this.demuxerMapKey, streamIndex);
        const result = this.writeContextMap.has(key) ? key : null;
        this.keyCache.set(streamIndex, result);
        return result;
    }

    /** Whether this bucket maps the given stream index to a write context. */
    accepts(streamIndex: number): boolean {
        return this.writeKeyFor(streamIndex) !== null;
    }

    pull(): HeapEntry | null {
        while (this.buffer.length > 0) {
            const pkt = this.buffer.shift()!;
            if (this.writeKeyFor(pkt.streamIndex) !== null) {
                return { sortDtsUs: computeSortDtsUs(pkt), packet: pkt, bucket: this };
            }
            pkt.free();
        }
        return null;
    }

    get size(): number {
        return this.buffer.length;
    }
}

// #endregion SyncPacketBucket

// #region DemuxPacketReader

/**
 * Packet reader that reads packets with a zero-clone path.
 *
 * The default `demuxer.packetsSync()` / `demuxer.packets()` clone every packet
 * (av_packet_clone), which is the dominant per-packet cost (~1.1-2.3ms/packet)
 * and caps the mux loop at ~500-750 p/s. Instead, we read directly into a
 * single reused `Packet` via `FormatContext.readFrameSync()`/`readFrame()`,
 * apply the same timestamp processing the demuxer would, and `ref()`
 * (av_packet_ref — shares the buffer, no copy) into owned packets for the
 * buckets. This eliminates the demuxer clone and gives ~4x throughput.
 *
 * File-based sources use sync reads (`readFrameSync`); pipe/stream-based
 * sources (e.g. preprocessed Opus from opusenc) use async reads (`readFrame`),
 * which properly handle async I/O callbacks.
 */
export class DemuxPacketReader {
    private readonly isAsync: boolean;
    private readonly demuxer: Demuxer;
    private readonly reusedPacket: PacketImpl;
    private _exhausted = false;
    /** Scratch buffer for Atomics.wait() EAGAIN retries (mirrors FFmpeg's av_usleep). */
    private readonly syncSleepSignal = new Int32Array(new SharedArrayBuffer(4));

    /**
     * Streams snapshot, taken once. `Demuxer.getStream()` resolves through the
     * `formatContext.streams` getter, which does
     * `nativeStreams.map(ns => new Stream(ns))` — allocating a fresh wrapper for
     * EVERY stream in the file on EVERY access. At 20 streams that is 20 NAPI
     * object allocations per packet just to look one up. The stream list is fixed
     * for a demuxer's lifetime, so snapshot it here and index directly.
     */
    private readonly streams: readonly Stream[];
    /**
     * Per-stream time base num/den, pre-resolved. `packet.timeBase` and
     * `stream.timeBase` are both NAPI round-trips that allocate a `Rational` per
     * access; reading them once per stream removes 2+ allocations per packet.
     */
    private readonly streamTimeBases: readonly RationalLike[];

    constructor(demuxer: Demuxer, useAsync: boolean) {
        this.isAsync = useAsync;
        this.demuxer = demuxer;
        this.reusedPacket = new PacketImpl();
        this.reusedPacket.alloc();

        this.streams = demuxer.getFormatContext().streams ?? [];
        this.streamTimeBases = this.streams.map(s => {
            const tb = s.timeBase;
            return { num: tb.num, den: tb.den };
        });
    }

    /** Look up a stream without going through the allocating getter. */
    private streamFor(index: number): Stream | undefined {
        const s = this.streams[index];
        return s !== undefined ? s : undefined;
    }

    get exhausted(): boolean {
        return this._exhausted;
    }

    async fillBuckets(buckets: SyncPacketBucket[], targetPerBucket: number): Promise<void> {
        if (this._exhausted) return;
        if (this.isAsync) {
            await this.fillBucketsAsync(buckets, targetPerBucket);
        } else {
            this.fillBucketsSync(buckets, targetPerBucket);
        }
    }

    /**
     * Apply the same per-packet timestamp processing that `packetsSync()`/
     * `packets()` applies, so the zero-clone path produces identical output.
     *
     * The timestamp methods are typed `private` in node-av's `.d.ts` but are
     * public at runtime. We reach them via a cast to avoid replicating the
     * (complex) discontinuity logic, which must stay identical to the demuxer's.
     */
    private processTimestamps(packet: PacketImpl, stream: Stream | undefined): void {
        if (!stream) return;
        const demuxer = this.demuxer as unknown as {
            ptsWrapAroundCorrection(p: PacketImpl, s: Stream): void;
            timestampDiscontinuityProcess(p: PacketImpl, s: Stream): void;
            dtsPredict(p: PacketImpl, s: Stream): void;
        };
        // Set the time base from the pre-resolved copy rather than
        // `stream.timeBase`, which is a NAPI round-trip plus a `Rational`
        // allocation on every read.
        const tb = this.streamTimeBases[packet.streamIndex];
        if (tb !== undefined) {
            packet.timeBase = tb;
        }
        demuxer.ptsWrapAroundCorrection(packet, stream);
        demuxer.timestampDiscontinuityProcess(packet, stream);
        demuxer.dtsPredict(packet, stream);
    }

    /**
     * Create an owned packet that shares the reused packet's buffer via
     * av_packet_ref (no data copy). The caller owns and must free it.
     */
    private refOwnedPacket(): PacketImpl {
        const owned = new PacketImpl();
        owned.alloc();
        const ret = owned.ref(this.reusedPacket);
        if (ret < 0) {
            owned.free();
            throw new FFmpegError(ret);
        }
        return owned;
    }

    private fillBucketsSync(buckets: SyncPacketBucket[], targetPerBucket: number): void {
        const fc = this.demuxer.getFormatContext();
        while (true) {
            if (allBucketsFilled(buckets, targetPerBucket)) return;

            const ret = fc.readFrameSync(this.reusedPacket);
            if (ret < 0) {
                if (ret === AVERROR_EAGAIN) {
                    // No data available yet (live source) — blocking retry.
                    Atomics.wait(this.syncSleepSignal, 0, 0, 10);
                    continue;
                }
                if (!FFmpegError.is(ret, AVERROR_EOF) && !FFmpegError.is(ret, AVERROR_EXIT)) {
                    throw new FFmpegError(ret);
                }
                this._exhausted = true;
                for (const b of buckets) { if (b.size === 0) b.exhausted = true; }
                return;
            }

            const stream = this.streamFor(this.reusedPacket.streamIndex);
            this.processTimestamps(this.reusedPacket, stream);

            const owned = this.refOwnedPacket();
            dispatchToBucket(owned, buckets, targetPerBucket);
            this.reusedPacket.unref();
        }
    }

    private async fillBucketsAsync(buckets: SyncPacketBucket[], targetPerBucket: number): Promise<void> {
        const fc = this.demuxer.getFormatContext();
        while (true) {
            if (allBucketsFilled(buckets, targetPerBucket)) return;

            const ret = await fc.readFrame(this.reusedPacket);
            if (ret < 0) {
                if (ret === AVERROR_EAGAIN) {
                    await new Promise<void>(resolve => setTimeout(resolve, 10));
                    continue;
                }
                if (!FFmpegError.is(ret, AVERROR_EOF) && !FFmpegError.is(ret, AVERROR_EXIT)) {
                    throw new FFmpegError(ret);
                }
                this._exhausted = true;
                for (const b of buckets) { if (b.size === 0) b.exhausted = true; }
                return;
            }

            const stream = this.streamFor(this.reusedPacket.streamIndex);
            this.processTimestamps(this.reusedPacket, stream);

            const owned = this.refOwnedPacket();
            dispatchToBucket(owned, buckets, targetPerBucket);
            this.reusedPacket.unref();
        }
    }

    async close(): Promise<void> {
        try {
            this.reusedPacket.free();
        } catch { /* ignore */ }
        this._exhausted = true;
    }
}

// #endregion DemuxPacketReader

// #region Standalone dispatch helpers

/**
 * Check whether all buckets have reached the target fill level.
 */
function allBucketsFilled(buckets: SyncPacketBucket[], targetPerBucket: number): boolean {
    for (const b of buckets) {
        if (b.size < targetPerBucket && !b.exhausted) return false;
    }
    return true;
}

/**
 * Dispatch a packet to the first bucket whose demuxerMapKey + streamIndex
 * is registered in writeContextMap. If no bucket accepts it, free the packet.
 *
 * `accepts` is memoized per bucket/stream index by the bucket itself, so this
 * per-packet, per-bucket scan does no string building or Map lookups with
 * freshly concatenated keys after the first packet for a given index.
 */
function dispatchToBucket(
    packet: Packet,
    buckets: SyncPacketBucket[],
    targetPerBucket: number,
): void {
    const streamIndex = packet.streamIndex;
    for (const b of buckets) {
        if (b.accepts(streamIndex)) {
            if (b.size < targetPerBucket) {
                b.push(packet);
            } else {
                packet.free();
            }
            return;
        }
    }
    packet.free();
}

// #endregion Standalone dispatch helpers
