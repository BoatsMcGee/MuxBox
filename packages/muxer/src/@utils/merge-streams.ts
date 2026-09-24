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
}

export interface HeapEntry {
    sortDtsUs: number;
    packet: Packet;
    bucket: SyncPacketBucket;
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

    constructor(demuxerMapKey: string, writeContextMap: ReadonlyMap<string, WriteContext>) {
        this.demuxerMapKey = demuxerMapKey;
        this.writeContextMap = writeContextMap;
    }

    push(packet: Packet): void {
        this.buffer.push(packet);
    }

    pull(): HeapEntry | null {
        while (this.buffer.length > 0) {
            const pkt = this.buffer.shift()!;
            const writeKey = buildWriteKey(this.demuxerMapKey, pkt.streamIndex);
            if (this.writeContextMap.has(writeKey)) {
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

    private readonly writeContextMap: ReadonlyMap<string, WriteContext>;

    constructor(
        demuxer: Demuxer,
        useAsync: boolean,
        writeContextMap: ReadonlyMap<string, WriteContext>,
    ) {
        this.writeContextMap = writeContextMap;
        this.isAsync = useAsync;
        this.demuxer = demuxer;
        this.reusedPacket = new PacketImpl();
        this.reusedPacket.alloc();
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
        packet.timeBase = stream.timeBase;
        const demuxer = this.demuxer as unknown as {
            ptsWrapAroundCorrection(p: PacketImpl, s: Stream): void;
            timestampDiscontinuityProcess(p: PacketImpl, s: Stream): void;
            dtsPredict(p: PacketImpl, s: Stream): void;
        };
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

            const stream = this.demuxer.getStream(this.reusedPacket.streamIndex);
            this.processTimestamps(this.reusedPacket, stream);

            const owned = this.refOwnedPacket();
            dispatchToBucket(owned, buckets, targetPerBucket, this.writeContextMap);
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

            const stream = this.demuxer.getStream(this.reusedPacket.streamIndex);
            this.processTimestamps(this.reusedPacket, stream);

            const owned = this.refOwnedPacket();
            dispatchToBucket(owned, buckets, targetPerBucket, this.writeContextMap);
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
 */
function dispatchToBucket(
    packet: Packet,
    buckets: SyncPacketBucket[],
    targetPerBucket: number,
    writeContextMap: ReadonlyMap<string, WriteContext>,
): void {
    for (const b of buckets) {
        const writeKey = buildWriteKey(b.demuxerMapKey, packet.streamIndex);
        if (writeContextMap.has(writeKey)) {
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
