import { AV_NOPTS_VALUE, type Packet } from 'node-av';
import type { WriteContext } from '../@utils/merge-streams.js';
import { formatTime } from '../../../utils/src/time.js';

// #region Types

export type CodecType = 'video' | 'audio' | 'subtitle' | 'attachment';

/**
 * Serializable stream information extracted from node-av demuxer streams.
 * Mirrors the StreamInfo interface in @app/preload. Returned from
 * EpisodeMuxer.getStreamInfos() so the renderer can read stream metadata
 * without opening the file a second time via demuxStreams().
 */
export interface StreamInfo {
    index: number;
    codecType: number;
    codecId: number;
    codecName: string;
    /** Title, language, filename, mimetype, etc. from stream metadata dict. */
    metadata: Record<string, string>;
    /** Numeric AV_DISPOSITION_* flag values. */
    dispositions: number[];
    /** Video width in pixels. */
    width?: number;
    /** Video height in pixels. */
    height?: number;
    /**
     * FFmpeg field order (AVFieldOrder) indicating interlaced/progressive.
     * 0=unknown, 1=progressive, 2+=interlaced (TT=2, BB=3, TB=4, BT=5).
     * Populated from AVCodecParameters.field_order via toJSON().
     */
    fieldOrder?: number;
    /** Audio channel count. */
    channels?: number;
    /** Audio sample rate in Hz. */
    sampleRate?: number;
    /** Bit rate in bits per second. */
    bitRate?: number;
    /** Duration in seconds from the demuxer format context. */
    duration?: number;
    /**
     * Rich display metadata from MediaInfo (per-stream track object).
     * Only available when MediaInfo was able to analyse the file.
     */
    extra?: Record<string, unknown>;
    /**
     * Container-level metadata (format info, writing app, chapters, etc.).
     * Only populated on the first stream entry (index 0).
     */
    containerMeta?: Record<string, unknown>;
}

/**
 * Pre-mux track metadata comparison: what was in the source vs what will be in the output.
 * Available after `tracks:ready` event is emitted (before muxing begins).
 */
export interface TrackComparison {
    /** The output stream index (assigned when Muxer.addStream() is called). */
    outputIndex: number;
    /** Codec type category. */
    codecType: CodecType;
    /** The demuxer key the stream came from (file path or pipe key). */
    demuxerMapKey: string;
    /** Original stream index in the source container. */
    originalIndex: number;

    // ── Original (source) metadata ──
    originalCodec: string;
    originalTitle: string | undefined;
    originalLanguage: string | undefined;
    originalDispositions: string[];

    // ── Muxed (output) metadata ──
    muxedCodec: string;
    muxedTitle: string | undefined;
    muxedLanguage: string | undefined;
    muxedDispositions: string[];
    /** Attachment filename from metadata.filename */
    muxedFilename: string | undefined;
    /** Attachment MIME type from metadata.mimetype */
    muxedMimetype: string | undefined;
    /**
     * Full muxed (output) metadata dict after source modifications.
     * Populated in the simulator path; may be absent in real muxer path.
     */
    muxedMetadata?: Record<string, string>;
    /**
     * Delay in milliseconds applied to this track by the source
     * (stream-match rule `modify.delay` merged with per-track modifiers).
     * Only audio/subtitle tracks support delay; video/attachment are 0.
     */
    muxedDelay?: number;
}

/** Per-stream runtime progress snapshot during the merge phase. */
export interface StreamSnapshot {
    streamKey: string;
    outputIndex: number;
    codecType: CodecType;
    packetsWritten: number;
    lastDts: bigint | undefined;
    lastPts: bigint | undefined;
    timeBaseNum: number;
    timeBaseDen: number;
    /**
     * Stream duration in microseconds, or undefined if unknown.
     * Derived from the Demuxer stream or container duration.
     * This is the authoritative measure of this stream's total length.
     */
    durationUs: number | undefined;
    /** Formatted timecode "HH:MM:SS.mmm" from last DTS. */
    timecode: string;
    /** Progress 0–100, or -1 if duration is unknown. Computed as DTS ÷ duration. */
    percent: number;
}

/** Per-source aggregation of child stream snapshots. */
export interface SourceSnapshot {
    demuxerMapKey: string;
    /** Short display name (filename or pipe label). */
    sourceName: string;
    packetsWritten: number;
    streams: StreamSnapshot[];
    /** Max DTS timecode across child video+audio streams. */
    timecode: string;
    /** Max percent across child video+audio streams. */
    percent: number;
}

/**
 * Full mux progress snapshot for one episode.
 * Contains per-stream, per-source, and aggregate views.
 * All timing is derived from DTS and stream/container duration — no heuristics.
 */
export interface MuxSnapshot {
    episodeLabel: string;
    /** Always 'muxing' in current design. Reserved for future non-streamed preprocessing. */
    phase: 'muxing' | 'complete' | 'error';
    /** Per-stream progress snapshots, keyed by streamKey. */
    streams: Map<string, StreamSnapshot>;
    /** Per-source progress snapshots, keyed by demuxerMapKey. */
    sources: Map<string, SourceSnapshot>;
    totalPacketsWritten: number;
    /**
     * Aggregate timecode: min of max video DTS and max audio DTS.
     * Only video and audio are used since those are the continuous track types.
     */
    totalTimecode: string;
    /**
     * Aggregate position in microseconds.
     * Derived from totalTimecode for reliable arithmetic (comparing timecode strings is fragile).
     */
    totalPositionUs: number;
    /**
     * Aggregate percentage: min of max video % and max audio %.
     */
    totalPercent: number;
    /**
     * The maximum duration across all video/audio streams, in microseconds.
     * This is the authoritative reference for overall progress.
     */
    totalDurationUs: number | undefined;
    elapsedMs: number;
    pps: number;
    /**
     * Duration-based ETA in milliseconds.
     * Computed as: (totalDurationUs - totalPositionUs) / (totalPositionUs / elapsedMs).
     * More reliable than packet-count-based estimation.
     */
    estimatedRemainingMs: number | undefined;
    error: string | undefined;
}

// #endregion Types

// #region Helpers

/**
 * Convert a raw DTS value + time base to "HH:MM:SS.mmm" timecode string.
 * Returns "--:--:--.---" when DTS is AV_NOPTS_VALUE.
 */
export function dtsToTimecode(dts: bigint, timeBaseNum: number, timeBaseDen: number): string {
    if (dts === AV_NOPTS_VALUE) return '--:--:--.---';
    const seconds = Number(dts) * timeBaseNum / timeBaseDen;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.floor((seconds % 1) * 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

/**
 * Convert DTS + timebase to microseconds.
 * Returns -1 if DTS is AV_NOPTS_VALUE.
 */
export function dtsToUs(dts: bigint, timeBaseNum: number, timeBaseDen: number): number {
    if (dts === AV_NOPTS_VALUE) return -1;
    return Number(dts) * timeBaseNum / timeBaseDen * 1_000_000;
}

/**
 * Compute progress percentage from DTS and duration.
 * Returns -1 when duration is unknown or falsy.
 */
export function computePercent(dts: bigint, timeBaseNum: number, timeBaseDen: number, durationUs: number | undefined): number {
    if (!durationUs || durationUs <= 0) return -1;
    if (dts === AV_NOPTS_VALUE) return -1;
    const packetTimeUs = Number(dts) * timeBaseNum / timeBaseDen * 1_000_000;
    return Math.min(100, Math.round((packetTimeUs / durationUs) * 100));
}

/**
 * Given a stream writeKey, determine its parent source key (demuxerMapKey).
 * Preprocessed streams use the part before ":preprocess:".
 * File-based streams strip the last `:number` suffix.
 */
export function resolveSourceKey(streamKey: string): string {
    const preprocessIdx = streamKey.indexOf(':preprocess:');
    if (preprocessIdx !== -1) {
        return streamKey.slice(0, preprocessIdx + ':preprocess:'.length - 1);
    }
    // File-based key format: "path:streamIndex" — strip the last `:number` part
    const lastColon = streamKey.lastIndexOf(':');
    if (lastColon === -1) return streamKey;
    return streamKey.slice(0, lastColon);
}

/**
 * Human-readable source name from a demuxerMapKey (file path or pipe key).
 */
export function sourceNameFromKey(demuxerMapKey: string): string {
    const preprocessIdx = demuxerMapKey.indexOf(':preprocess:');
    if (preprocessIdx !== -1) {
        return `<pipe:${demuxerMapKey.slice(preprocessIdx + ':preprocess:'.length)}>`;
    }
    // Extract filename from path
    const normalized = demuxerMapKey.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash !== -1 ? normalized.slice(lastSlash + 1) : normalized;
}

// #endregion Helpers

// #region MuxProgressTracker

/** Internal per-stream state for the tracker. */
interface StreamState {
    packetsWritten: number;
    lastDts: bigint | undefined;
    lastPts: bigint | undefined;
    timeBaseNum: number;
    timeBaseDen: number;
    /** Duration in microseconds. Set via setDurationUs(). */
    durationUs: number | undefined;
    codecType: CodecType;
    outputIndex: number;
}

/** Internal per-source state. */
interface SourceState {
    childKeys: string[];
}

/**
 * Accumulates merge progress state and produces MuxSnapshot on demand.
 *
 * Usage:
 *   1. Create instance before merge loop.
 *   2. Call setDurationUs() for each stream that has a known duration.
 *   3. Call recordPacket() after each writePacketSync().
 *   4. Call snapshot() from a timer or on query to get current progress.
 *
 * All timing/progress is DTS-derived from the actual packets being merged.
 * ETA is computed from the aggregate duration vs position — no framerate heuristics.
 */
export class MuxProgressTracker {
    private readonly streamStates = new Map<string, StreamState>();
    private readonly sourceStates = new Map<string, SourceState>();
    private readonly mergeStart: number;
    private totalPackets = 0;
    private error: string | undefined;
    private phase: MuxSnapshot['phase'] = 'muxing';

    private readonly episodeLabel: string;
    private readonly sourceNames: ReadonlyMap<string, string>;

    constructor(
        episodeLabel: string,
        writeContextMap: ReadonlyMap<string, WriteContext>,
        streamCodecTypes: ReadonlyMap<string, CodecType>,
        sourceNames: ReadonlyMap<string, string>,
    ) {
        this.episodeLabel = episodeLabel;
        this.sourceNames = sourceNames;
        this.mergeStart = Date.now();

        // Pre-populate stream states from writeContextMap
        for (const [key, ctx] of writeContextMap) {
            const codecType = streamCodecTypes.get(key);
            if (!codecType) continue;
            this.streamStates.set(key, {
                packetsWritten: 0,
                lastDts: undefined,
                lastPts: undefined,
                timeBaseNum: ctx.timeBaseNum,
                timeBaseDen: ctx.timeBaseDen,
                durationUs: undefined,
                codecType,
                outputIndex: ctx.outputIndex,
            });
        }

        // Pre-populate source states
        for (const [key] of this.sourceNames) {
            this.sourceStates.set(key, { childKeys: [] });
        }
        // Assign each stream to its source
        for (const streamKey of writeContextMap.keys()) {
            const sourceKey = resolveSourceKey(streamKey);
            let state = this.sourceStates.get(sourceKey);
            if (!state) {
                state = { childKeys: [] };
                this.sourceStates.set(sourceKey, state);
            }
            state.childKeys.push(streamKey);
        }
    }

    /**
     * Record a written packet.
     * Call this after each writePacketSync() call.
     */
    recordPacket(streamKey: string, packet: Packet): void {
        const state = this.streamStates.get(streamKey);
        if (!state) return;

        state.packetsWritten++;
        state.lastDts = packet.dts;
        state.lastPts = packet.pts;
        this.totalPackets++;
    }

    /**
     * Set the duration for a specific stream, used for percentage calculation.
     * Duration must be in microseconds.
     * Call this before the merge loop starts for streams with known durations.
     */
    setDurationUs(streamKey: string, durationUs: number): void {
        const state = this.streamStates.get(streamKey);
        if (state) {
            state.durationUs = durationUs;
        }
    }

    /** Mark the mux as errored. */
    setError(err: string): void {
        this.error = err;
        this.phase = 'error';
    }

    /** Mark the mux as complete. */
    setComplete(): void {
        this.phase = 'complete';
    }

    /** Produce a MuxSnapshot from current state. */
    snapshot(): MuxSnapshot {
        const elapsedMs = Date.now() - this.mergeStart;
        const pps = elapsedMs > 0 ? (this.totalPackets / (elapsedMs / 1000)) : 0;

        // Build per-stream snapshots
        const streamSnapshots = new Map<string, StreamSnapshot>();
        for (const [key, state] of this.streamStates) {
            const timecode = state.lastDts !== undefined
                ? dtsToTimecode(state.lastDts, state.timeBaseNum, state.timeBaseDen)
                : '--:--:--.---';
            const percent = state.lastDts !== undefined
                ? computePercent(state.lastDts, state.timeBaseNum, state.timeBaseDen, state.durationUs)
                : -1;

            streamSnapshots.set(key, {
                streamKey: key,
                outputIndex: state.outputIndex,
                codecType: state.codecType,
                packetsWritten: state.packetsWritten,
                lastDts: state.lastDts,
                lastPts: state.lastPts,
                timeBaseNum: state.timeBaseNum,
                timeBaseDen: state.timeBaseDen,
                durationUs: state.durationUs,
                timecode,
                percent,
            });
        }

        // Build per-source snapshots
        const sourceSnapshots = new Map<string, SourceSnapshot>();
        for (const [sourceKey, sState] of this.sourceStates) {
            const childStreams: StreamSnapshot[] = [];
            let sourcePackets = 0;
            for (const childKey of sState.childKeys) {
                const ss = streamSnapshots.get(childKey);
                if (ss) {
                    childStreams.push(ss);
                    sourcePackets += ss.packetsWritten;
                }
            }

            // Source timecode = max DTS across video+audio children
            const videoAudioStreams = childStreams.filter(s => s.codecType === 'video' || s.codecType === 'audio');
            let maxDtsTimecode = '--:--:--.---';
            let maxPercent: number = -1;
            let maxUs = -1;
            for (const s of videoAudioStreams) {
                if (s.percent > maxPercent) maxPercent = s.percent;
                if (s.lastDts !== undefined) {
                    const state = this.streamStates.get(s.streamKey);
                    if (state && state.lastDts !== undefined) {
                        const us = Number(state.lastDts) * state.timeBaseNum / state.timeBaseDen * 1_000_000;
                        if (us > maxUs) {
                            maxUs = us;
                            maxDtsTimecode = s.timecode;
                        }
                    }
                }
            }

            sourceSnapshots.set(sourceKey, {
                demuxerMapKey: sourceKey,
                sourceName: this.sourceNames.get(sourceKey) ?? sourceNameFromKey(sourceKey),
                packetsWritten: sourcePackets,
                streams: childStreams,
                timecode: maxDtsTimecode,
                percent: maxPercent,
            });
        }

        // Aggregate: find max video DTS and max audio DTS → take the min of those
        const videoStreams = [...streamSnapshots.values()].filter(s => s.codecType === 'video' && s.lastDts !== undefined);
        const audioStreams = [...streamSnapshots.values()].filter(s => s.codecType === 'audio' && s.lastDts !== undefined);

        let totalPositionUs = -1;
        let totalTimecode = '--:--:--.---';
        let totalPercent: number = -1;

        if (videoStreams.length > 0 || audioStreams.length > 0) {
            const maxVideoUs = findMaxDtsUs(videoStreams);
            const maxAudioUs = findMaxDtsUs(audioStreams);
            const maxVideoPct = findMaxPercent(videoStreams);
            const maxAudioPct = findMaxPercent(audioStreams);

            // Aggregate timecode = min(max video DTS, max audio DTS)
            // This represents "how far through the shortest continuous track" we are
            const positionCandidates: number[] = [];
            if (maxVideoUs !== -1) positionCandidates.push(maxVideoUs);
            if (maxAudioUs !== -1) positionCandidates.push(maxAudioUs);

            if (positionCandidates.length > 0) {
                totalPositionUs = Math.min(...positionCandidates);
                totalTimecode = usToTimecode(totalPositionUs);
            }

            // Aggregate percent = min(max video %, max audio %)
            const pctCandidates: number[] = [];
            if (maxVideoPct !== -1) pctCandidates.push(maxVideoPct);
            if (maxAudioPct !== -1) pctCandidates.push(maxAudioPct);
            if (pctCandidates.length > 0) {
                totalPercent = Math.round(Math.min(...pctCandidates));
            }
        }

        // Find the maximum known duration across all video/audio streams for ETA
        let totalDurationUs: number | undefined;
        for (const [, state] of this.streamStates) {
            if ((state.codecType === 'video' || state.codecType === 'audio') && state.durationUs !== undefined) {
                if (totalDurationUs === undefined || state.durationUs > totalDurationUs) {
                    totalDurationUs = state.durationUs;
                }
            }
        }

        // Duration-based ETA
        // rate = positionUs / elapsedMs  →  remaining = (totalDurationUs - positionUs) / rate
        let estimatedRemainingMs: number | undefined;
        if (totalPositionUs > 0 && totalDurationUs !== undefined && totalDurationUs > totalPositionUs && elapsedMs > 0) {
            const rate = totalPositionUs / elapsedMs; // microseconds per millisecond
            const remainingUs = totalDurationUs - totalPositionUs;
            estimatedRemainingMs = Math.round(remainingUs / rate);
        }

        return {
            episodeLabel: this.episodeLabel,
            phase: this.phase,
            streams: streamSnapshots,
            sources: sourceSnapshots,
            totalPacketsWritten: this.totalPackets,
            totalTimecode,
            totalPositionUs,
            totalPercent,
            totalDurationUs,
            elapsedMs,
            pps: Math.round(pps),
            estimatedRemainingMs,
            error: this.error,
        };
    }

    /** Get a brief one-line status string for console display. */
    statusLine(): string {
        const s = this.snapshot();
        const parts: string[] = [];
        if (s.totalPositionUs > 0) {
            const totalSec = (s.totalDurationUs ?? 0) / 1_000_000;
            const posSec = s.totalPositionUs / 1_000_000;
            if (totalSec > 0) {
                const pct = Math.round((posSec / totalSec) * 100);
                parts.push(`${pct}%`);
            }
            const tcParts = s.totalTimecode.split('.');
            parts.push(`${tcParts[0]}`);
        }
        parts.push(`${s.totalPacketsWritten} packets`);
        if (s.pps > 0) parts.push(`${s.pps} PPS`);
        if (s.estimatedRemainingMs !== undefined) parts.push(`ETA ${formatTime(s.estimatedRemainingMs)}`);
        return parts.join(' · ');
    }
}

// #endregion MuxProgressTracker

// #region Internal helpers

/**
 * Find the maximum DTS in microseconds across a list of stream snapshots.
 * Returns -1 if no valid DTS found.
 */
function findMaxDtsUs(streams: StreamSnapshot[]): number {
    let max = -1;
    for (const s of streams) {
        if (s.lastDts === undefined) continue;
        const us = Number(s.lastDts) * s.timeBaseNum / s.timeBaseDen * 1_000_000;
        if (us > max) max = us;
    }
    return max;
}

/**
 * Find the maximum percent across a list of stream snapshots.
 * Returns -1 if none have valid percent.
 */
function findMaxPercent(streams: StreamSnapshot[]): number {
    let max = -1;
    for (const s of streams) {
        if (s.percent > max) max = s.percent;
    }
    return max;
}

/**
 * Convert total microseconds to "HH:MM:SS.mmm" timecode string.
 */
function usToTimecode(us: number): string {
    if (us < 0) return '--:--:--.---';
    const totalMs = us / 1000;
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const millis = Math.floor(totalMs % 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

// #endregion Internal helpers

// #region IPC serialization

/**
 * Plain-object form of {@link MuxSnapshot} for IPC.
 * `Map` fields become plain objects and `bigint` DTS/PTS become `number`,
 * since neither is structured-cloneable across the Electron context bridge.
 */
export interface SerializedMuxSnapshot extends Omit<MuxSnapshot, 'streams' | 'sources'> {
    streams: Record<string, Record<string, unknown>>;
    sources: Record<string, Record<string, unknown>>;
}

function toPlain(value: unknown): Record<string, unknown> {
    if (value instanceof Map) return Object.fromEntries(value);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function toNumber(value: unknown): number {
    return typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : 0;
}

/**
 * Serialize a {@link MuxSnapshot} (or already-serialized plain-object form)
 * for IPC. Total function: never throws, and returns a minimal empty payload
 * for `undefined`/malformed input — the regression guard for
 * `TypeError: snap.streams is not iterable` when `job:failed` fired before
 * any progress snapshot existed.
 */
export function serializeSnapshot(snap: unknown): SerializedMuxSnapshot {
    const s = toPlain(snap);

    const streams: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(toPlain(s.streams))) {
        const ss = toPlain(value);
        streams[key] = { ...ss, lastDts: toNumber(ss.lastDts), lastPts: toNumber(ss.lastPts) };
    }

    const sources: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(toPlain(s.sources))) {
        const src = toPlain(value);
        sources[key] = Array.isArray(src.streams)
            ? { ...src, streams: src.streams.map((x: unknown) => {
                const ss = toPlain(x);
                return { ...ss, lastDts: toNumber(ss.lastDts), lastPts: toNumber(ss.lastPts) };
            }) }
            : src;
    }

    return {
        ...s,
        streams,
        sources,
        totalPacketsWritten: toNumber(s.totalPacketsWritten),
        totalPositionUs: toNumber(s.totalPositionUs),
        totalPercent: toNumber(s.totalPercent),
        elapsedMs: toNumber(s.elapsedMs),
        pps: toNumber(s.pps),
    } as SerializedMuxSnapshot;
}

// #endregion IPC serialization
