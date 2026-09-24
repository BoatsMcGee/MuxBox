import { spawn, type ChildProcess } from 'child_process';
import { PassThrough, type Readable } from 'node:stream';
import { resolveTool } from '@app/mkvtoolnix';
import {
    Demuxer,
    Muxer,
    Packet,
    FFmpegError,
    AVERROR_EOF,
    AVERROR_EXIT,
    AVERROR_EAGAIN,
    type IOOutputCallbacks,
    AV_CODEC_ID_FLAC,
    AV_CODEC_ID_PCM_S16LE,
    AV_CODEC_ID_PCM_S16BE,
    AV_CODEC_ID_PCM_U16LE,
    AV_CODEC_ID_PCM_U16BE,
    AV_CODEC_ID_PCM_S8,
    AV_CODEC_ID_PCM_U8,
    AV_CODEC_ID_PCM_MULAW,
    AV_CODEC_ID_PCM_ALAW,
    AV_CODEC_ID_PCM_S32LE,
    AV_CODEC_ID_PCM_S32BE,
    AV_CODEC_ID_PCM_U32LE,
    AV_CODEC_ID_PCM_U32BE,
    AV_CODEC_ID_PCM_S24LE,
    AV_CODEC_ID_PCM_S24BE,
    AV_CODEC_ID_PCM_U24LE,
    AV_CODEC_ID_PCM_U24BE,
    AV_CODEC_ID_PCM_S24DAUD,
    AV_CODEC_ID_PCM_ZORK,
    AV_CODEC_ID_PCM_S16LE_PLANAR,
    AV_CODEC_ID_PCM_DVD,
    AV_CODEC_ID_PCM_F32BE,
    AV_CODEC_ID_PCM_F32LE,
    AV_CODEC_ID_PCM_F64BE,
    AV_CODEC_ID_PCM_F64LE,
    AV_CODEC_ID_PCM_BLURAY,
    AV_CODEC_ID_PCM_LXF,
    AV_CODEC_ID_PCM_S8_PLANAR,
    AV_CODEC_ID_PCM_S24LE_PLANAR,
    AV_CODEC_ID_PCM_S32LE_PLANAR,
    AV_CODEC_ID_PCM_S16BE_PLANAR,
    AV_CODEC_ID_PCM_S64LE,
    AV_CODEC_ID_PCM_S64BE,
    AV_CODEC_ID_PCM_F16LE,
    AV_CODEC_ID_PCM_F24LE,
    AV_CODEC_ID_PCM_VIDC,
    AV_CODEC_ID_PCM_SGA,
    AVDISCARD_ALL,
    type AVCodecID,
} from 'node-av';
import { ffmpegPath } from 'node-av/ffmpeg';
import { acquireFfmpegSemaphore, releaseFfmpegSemaphore } from '../ffmpeg/concurrency.js';
import { parseTimeToSeconds } from '../../../utils/src/time.js';

export interface Options {
    bitrate?: number;
    downmix?: 'stereo' | 'mono';
    computationalComplexity?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
    framesize?: 2.5 | 5 | 10 | 20 | 40 | 60;
    volumeWorkaround?: boolean;
    normalize?: boolean;
}

function isPassthroughCodec(codecId: AVCodecID): boolean {
    const passthroughCodecs: AVCodecID[] = [
        AV_CODEC_ID_FLAC,
        AV_CODEC_ID_PCM_S16LE,
        AV_CODEC_ID_PCM_S16BE,
        AV_CODEC_ID_PCM_U16LE,
        AV_CODEC_ID_PCM_U16BE,
        AV_CODEC_ID_PCM_S8,
        AV_CODEC_ID_PCM_U8,
        AV_CODEC_ID_PCM_MULAW,
        AV_CODEC_ID_PCM_ALAW,
        AV_CODEC_ID_PCM_S32LE,
        AV_CODEC_ID_PCM_S32BE,
        AV_CODEC_ID_PCM_U32LE,
        AV_CODEC_ID_PCM_U32BE,
        AV_CODEC_ID_PCM_S24LE,
        AV_CODEC_ID_PCM_S24BE,
        AV_CODEC_ID_PCM_U24LE,
        AV_CODEC_ID_PCM_U24BE,
        AV_CODEC_ID_PCM_S24DAUD,
        AV_CODEC_ID_PCM_ZORK,
        AV_CODEC_ID_PCM_S16LE_PLANAR,
        AV_CODEC_ID_PCM_DVD,
        AV_CODEC_ID_PCM_F32BE,
        AV_CODEC_ID_PCM_F32LE,
        AV_CODEC_ID_PCM_F64BE,
        AV_CODEC_ID_PCM_F64LE,
        AV_CODEC_ID_PCM_BLURAY,
        AV_CODEC_ID_PCM_LXF,
        AV_CODEC_ID_PCM_S8_PLANAR,
        AV_CODEC_ID_PCM_S24LE_PLANAR,
        AV_CODEC_ID_PCM_S32LE_PLANAR,
        AV_CODEC_ID_PCM_S16BE_PLANAR,
        AV_CODEC_ID_PCM_S64LE,
        AV_CODEC_ID_PCM_S64BE,
        AV_CODEC_ID_PCM_F16LE,
        AV_CODEC_ID_PCM_F24LE,
        AV_CODEC_ID_PCM_VIDC,
        AV_CODEC_ID_PCM_SGA,
    ];
    return passthroughCodecs.includes(codecId);
}

/**
 * Build a pan filter string that downmixes surround channels to stereo or mono
 * using ITU-R BS.775-3 compliant coefficients to prevent clipping.
 *
 * For stereo downmix (5.1 → 2.0):
 *   L_out = 1.0*FL + 0.7071*FC + 0.7071*BL
 *   R_out = 1.0*FR + 0.7071*FC + 0.7071*BR
 *   (LFE is discarded as it is not intended for stereo reproduction)
 *
 * The 0.7071 (1/√2) factor for center and surround channels ensures
 * the summed output stays within [-1.0, 1.0] and avoids clipping.
 *
 * For mono downmix, all channels are averaged with equal weighting
 * that sums to ≤ 1.0 to prevent clipping.
 */
function buildPanFilter(numChannels: number, targetLayout: 'stereo' | 'mono'): string {
    // Standard input channel names in FFmpeg's channel layout order
    const channelNames = ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'FLC', 'FRC',
        'BC', 'SL', 'SR', 'TC', 'TFL', 'TFC', 'TFR', 'TBL', 'TBC', 'TBR',
        'DL', 'DR', 'WL', 'WR', 'SDL', 'SDR', 'LFE2'];

    const inputNames: string[] = [];
    for (let i = 0; i < numChannels; i++) {
        inputNames.push(i < channelNames.length ? channelNames[i] : `c${i}`);
    }

    if (targetLayout === 'stereo') {
        // ITU-R BS.775-3 downmix: L/R full, center/surrounds at 1/√2, LFE discarded
        const sqrt2inv = 0.7071;
        const leftChannels: string[] = [];
        const rightChannels: string[] = [];

        for (let i = 0; i < inputNames.length; i++) {
            const name = inputNames[i]!;
            // Map channels by their standard position
            switch (name) {
                // Front left group → full weight to left
                case 'FL':
                case 'FLC':
                case 'TFL':
                    leftChannels.push(`1.0*${name}`);
                    break;
                // Front right group → full weight to right
                case 'FR':
                case 'FRC':
                case 'TFR':
                    rightChannels.push(`1.0*${name}`);
                    break;
                // Center → equal weight to both at 1/√2
                case 'FC':
                case 'TFC':
                case 'TC':
                case 'BC':
                case 'TBC':
                    leftChannels.push(`${sqrt2inv}*${name}`);
                    rightChannels.push(`${sqrt2inv}*${name}`);
                    break;
                // Surround/rear left → reduced weight to left
                case 'BL':
                case 'SL':
                case 'TBL':
                case 'DL':
                case 'WL':
                case 'SDL':
                    leftChannels.push(`${sqrt2inv}*${name}`);
                    break;
                // Surround/rear right → reduced weight to right
                case 'BR':
                case 'SR':
                case 'TBR':
                case 'DR':
                case 'WR':
                case 'SDR':
                    rightChannels.push(`${sqrt2inv}*${name}`);
                    break;
                // LFE channels are discarded (not for stereo/mono reproduction)
                case 'LFE':
                case 'LFE2':
                    break;
                // Unknown channels: distribute equally to both outputs
                default: {
                    const coeff = 1.0 / numChannels;
                    leftChannels.push(`${coeff}*${name}`);
                    rightChannels.push(`${coeff}*${name}`);
                    break;
                }
            }
        }

        // If no channels were mapped (e.g., all LFE), fall back to simple average
        const leftExpr = leftChannels.length > 0 ? leftChannels.join('+') : '0.0';
        const rightExpr = rightChannels.length > 0 ? rightChannels.join('+') : '0.0';

        return `pan=stereo|FL=${leftExpr}|FR=${rightExpr}`;
    }

    // Mono: average all non-LFE channels equally, discard LFE
    const monoChannels: string[] = [];
    const nonLfeChannels = inputNames.filter(n => n !== 'LFE' && n !== 'LFE2');
    const weight = nonLfeChannels.length > 0 ? 1.0 / nonLfeChannels.length : 1.0;

    for (const name of nonLfeChannels) {
        monoChannels.push(`${weight}*${name}`);
    }

    const monoExpr = monoChannels.length > 0 ? monoChannels.join('+') : '0.0';
    return `pan=mono|c0=${monoExpr}`;
}

/**
 * Build the ffmpeg CLI args for the decode path (non-passthrough audio →
 * PCM WAV piped to opusenc stdin).
 *
 * The `-af` filter (when downmixing) must come before the output options
 * (`-c:a -f wav -`); placing it after `-f` makes ffmpeg parse `-af` as the
 * output format name ("Requested output format '-af' is not known").
 */
export function buildFfmpegDecodeArgs(sourcePath: string, streamIndex: number, downmixFilter?: string): string[] {
    return [
        '-i', sourcePath,
        '-map', `0:${streamIndex}`,
        ...(downmixFilter ? ['-af', downmixFilter] : []),
        '-c:a', 'pcm_s16le',
        '-f', 'wav',
        '-',
    ];
}

/** Bound the first-data wait so a dead pipeline fails instead of hanging. */
const FIRST_OUTPUT_TIMEOUT_MS = 120_000;

function waitForFirstOutput(stream: PassThrough, sourcePath: string, streamIndex: number, abort: () => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            abort();
            reject(new Error(`Opus preprocessing timed out for "${sourcePath}" stream ${streamIndex}`));
        }, FIRST_OUTPUT_TIMEOUT_MS);
        timer.unref?.();
        const done = (): void => clearTimeout(timer);
        stream.once('readable', () => {
            if (stream.readableLength > 0) {
                done();
                resolve();
            }
        });
        stream.once('error', (err: Error) => {
            done();
            abort();
            reject(err);
        });
        stream.once('end', () => {
            done();
            abort();
            reject(new Error(`Opus preprocessing failed for "${sourcePath}" stream ${streamIndex}: pipe ended before output`));
        });
        stream.once('close', () => {
            done();
            abort();
            reject(new Error(`Opus preprocessing failed for "${sourcePath}" stream ${streamIndex}: pipe closed before output`));
        });
        if (stream.readableLength > 0) {
            done();
            resolve();
        }
    });
}

/**
 * Get codec info for a specific stream using a temporary demuxer.
 * Returns the stream's codec ID, channel count, sample rate, and duration.
 */
async function getStreamInfo(sourcePath: string, streamIndex: number): Promise<{
    codecId: AVCodecID;
    channels: number;
    sampleRate: number;
    duration: number;
}> {
    await acquireFfmpegSemaphore();
    let demuxer: Demuxer | undefined;
    try {
        demuxer = await Demuxer.open(sourcePath);
        const stream = demuxer.getStream(streamIndex);
        if (!stream) throw new Error(`Stream ${streamIndex} not found in ${sourcePath}`);

        const codecId = stream.codecpar.codecId;
        const channels = stream.codecpar.channels;
        const sampleRate = stream.codecpar.sampleRate;
        // Duration from demuxer format context (in AV_TIME_BASE = microseconds)
        const fmtDuration = demuxer.getFormatContext()?.duration;
        const duration = fmtDuration && fmtDuration > 0n
            ? Number(fmtDuration) / 1_000_000
            : 0;

        return { codecId, channels, sampleRate, duration };
    } finally {
        if (demuxer) demuxer.close();
        releaseFfmpegSemaphore();
    }
}

/**
 * Result of starting an opusenc preprocessing pipeline.
 * The cleanup function must be called when the muxer is disposed or cancelled
 * to avoid a race condition where the background pipeline continues using
 * native FFmpeg resources after asyncDispose has started.
 */
export interface OpusencResult {
    stream: Readable;
    /** Stop opusenc / ffmpeg subprocesses and wait for the background pipeline to finish. */
    cleanup: () => Promise<void>;
}

export async function pipeAudioToOpusenc(
    sourcePath: string,
    streamIndex: number,
    options: Options,
    onProgress?: (progress: number) => void,
): Promise<OpusencResult> {
    const opusStream = new PassThrough();

    // Get stream info using a temporary demuxer (needed to decide passthrough
    // vs decode, and to configure opusenc's raw-PCM input flags).
    const streamInfo = await getStreamInfo(sourcePath, streamIndex);
    const streamDurationSeconds = streamInfo.duration;

    // If downmix is requested, we must decode and filter even if source is FLAC/PCM
    const canPassthrough = isPassthroughCodec(streamInfo.codecId) && !options.downmix;

    const opusencArgs = [
        ...(options.bitrate ? ['--bitrate', options.bitrate.toString()] : []),
        ...(options.computationalComplexity ? ['--comp', options.computationalComplexity.toString()] : []),
        ...(options.framesize ? ['--framesize', options.framesize.toString()] : []),
    ];

    const opusenc: ChildProcess = spawn(resolveTool('opusenc'), [...opusencArgs, '-', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    let ffmpeg: ChildProcess | undefined;

    // Prevent uncaught throws if the pipe fails before the wait below attaches.
    opusStream.on('error', () => { /* handled by the first-data wait */ });

    // Prevent uncaught throws on spawn failure; the wait below surfaces it.
    opusenc.on('error', () => {
        ffmpeg?.kill();
    });

    // Suppress EPIPE errors on opusenc stdin
    opusenc.stdin?.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EPIPE') return;
        console.error(`opusenc stdin error: ${err.message}`);
    });

    // Pipe opusenc stdout directly into the PassThrough stream
    opusenc.stdout?.pipe(opusStream);

    // Progress parsing from opusenc stderr
    const progressRegex = /^\s*\[.?].*\s+(\d+:\d+:\d+\.\d+)/;
    let lastProgress = -1;
    opusenc.stderr?.on('data', (data: Buffer) => {
        for (const line of data.toString().split('\n')) {
            const match = line.match(progressRegex);
            if (match) {
                const elapsed = parseTimeToSeconds(match[1]!);
                const progress = streamDurationSeconds > 0
                    ? Math.min(100, Math.round((elapsed / streamDurationSeconds) * 100)) : 0;
                if (progress !== lastProgress && progress >= 0 && progress <= 100) {
                    lastProgress = progress;
                    onProgress?.(progress);
                }
            }
        }
    });

    // Track background pipeline state for cleanup
    let backgroundPipelinePromise: Promise<void> | undefined;
    const backgroundAbortController = new AbortController();

    // Cleanup function: stops subprocesses and waits for the background pipeline
    // to finish. Must be called before disposing demuxers to avoid a race
    // condition where the pipeline continues reading from a disposed demuxer.
    const cleanup = async (): Promise<void> => {
        // Signal the background pipeline to stop
        backgroundAbortController.abort();

        // Kill opusenc to unblock any pending writes
        opusenc.kill();

        // Kill ffmpeg if decode path is active
        if (ffmpeg && !ffmpeg.killed) {
            ffmpeg.kill();
        }

        // Wait for the background pipeline to finish its cleanup
        if (backgroundPipelinePromise) {
            try {
                await backgroundPipelinePromise;
            } catch {
                // Ignore errors during cleanup — the pipeline's catch block
                // handles resource disposal.
            }
        }

        // Destroy the PassThrough stream to unblock any pending reads
        opusStream.destroy();
    };

    if (canPassthrough) {
        // ---------------------------------------------------------------
        // Passthrough path: FLAC/PCM → node-av remux → opusenc
        // ---------------------------------------------------------------
        const format = streamInfo.codecId === AV_CODEC_ID_FLAC ? 'flac' : 'wav';

        // Open a fresh demuxer for packet reading
        await acquireFfmpegSemaphore();
        let passthroughDemuxer: Demuxer;
        try {
            passthroughDemuxer = await Demuxer.open(sourcePath);
        } finally {
            releaseFfmpegSemaphore();
        }
        const passthroughStream = passthroughDemuxer.getStream(streamIndex);

        if (!passthroughStream) {
            opusenc.kill();
            opusStream.destroy(new Error(`Stream ${streamIndex} not found in ${sourcePath}`));
            return { stream: opusStream, cleanup };
        }

        // Mark non-target streams as discarded so av_read_frame skips them.
        for (const s of passthroughDemuxer.streams) {
            if (s.index !== streamIndex) {
                s.discard = AVDISCARD_ALL;
            }
        }

        const outputCallbacks: IOOutputCallbacks = {
            write: (buffer: Buffer): number => {
                const stdin = opusenc.stdin;
                // opusenc may have exited early (bad input, missing codec).
                if (!stdin || stdin.destroyed) {
                    throw new Error('opusenc stdin is closed');
                }
                stdin.write(buffer);
                return buffer.length;
            },
            seek: (_offset: bigint, _whence: number): bigint => -1n,
        };

        const output = await Muxer.open(outputCallbacks, { format });
        const outputIndex = output.addStream(passthroughStream);

        // Run the passthrough pipeline in the background. Tracked so cleanup
        // can await it before demuxers are disposed.
        backgroundPipelinePromise = (async (): Promise<void> => {
            const fc = passthroughDemuxer.getFormatContext();
            const reusedPacket = new Packet();
            reusedPacket.alloc();
            try {
                while (!backgroundAbortController.signal.aborted) {
                    const ret = await fc.readFrame(reusedPacket);
                    if (ret < 0) {
                        if (ret === AVERROR_EAGAIN) {
                            await new Promise<void>(resolve => setTimeout(resolve, 10));
                            continue;
                        }
                        if (!FFmpegError.is(ret, AVERROR_EOF) && !FFmpegError.is(ret, AVERROR_EXIT)) {
                            throw new FFmpegError(ret);
                        }
                        break;
                    }
                    // Only process packets from the target stream. readFrame reads
                    // all streams; packets() filtered by streamIndex, so we must too.
                    if (reusedPacket.streamIndex !== streamIndex) {
                        reusedPacket.unref();
                        continue;
                    }
                    // Apply the same timestamp processing packets() would.
                    reusedPacket.timeBase = passthroughStream.timeBase;
                    const demuxer = passthroughDemuxer as unknown as {
                        ptsWrapAroundCorrection(p: Packet, s: typeof passthroughStream): void;
                        timestampDiscontinuityProcess(p: Packet, s: typeof passthroughStream): void;
                        dtsPredict(p: Packet, s: typeof passthroughStream): void;
                    };
                    demuxer.ptsWrapAroundCorrection(reusedPacket, passthroughStream);
                    demuxer.timestampDiscontinuityProcess(reusedPacket, passthroughStream);
                    demuxer.dtsPredict(reusedPacket, passthroughStream);

                    // writePacket clones internally, so the reused packet stays valid.
                    await output.writePacket(reusedPacket, outputIndex);
                    reusedPacket.unref();
                }

                await output[Symbol.asyncDispose]();
                passthroughDemuxer[Symbol.dispose]();
                opusenc.stdin?.end();
            } catch {
                opusenc.kill();
                try { await output[Symbol.asyncDispose](); } catch { /* */ }
                try { passthroughDemuxer[Symbol.dispose](); } catch { /* */ }
            } finally {
                try { reusedPacket.free(); } catch { /* */ }
            }
        })();
    } else {
        // ---------------------------------------------------------------
        // Decode path: FFmpeg CLI subprocess → PCM → opusenc
        // ---------------------------------------------------------------
        let downmixFilter: string | undefined;
        if (options.downmix) {
            const numChannels = streamInfo.channels;
            const targetChannels = options.downmix === 'stereo' ? 2 : 1;

            if (numChannels > targetChannels) {
                const targetLayout = options.downmix === 'stereo' ? 'stereo' : 'mono';
                downmixFilter = buildPanFilter(numChannels, targetLayout);
            }
        }
        const ffmpegArgs: string[] = buildFfmpegDecodeArgs(sourcePath, streamIndex, downmixFilter);

        ffmpeg = spawn(ffmpegPath(), ffmpegArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        // Pipe ffmpeg stdout → opusenc stdin
        if (opusenc.stdin) {
            ffmpeg.stdout?.pipe(opusenc.stdin);
        }

        // Drain stderr to prevent backpressure.
        ffmpeg.stderr?.resume();

        ffmpeg.on('error', () => {
            opusenc.kill();
        });

        ffmpeg.on('exit', (code: number | null) => {
            if (code !== 0) {
                opusenc.kill();
            }
        });
    }

    // Wait until the first encoded bytes are buffered so a dead pipeline
    // fails instead of hanging (or failing later with a bare "End of file").
    await waitForFirstOutput(opusStream, sourcePath, streamIndex, () => {
        try { opusenc.kill(); } catch { /* already exited */ }
        try { ffmpeg?.kill(); } catch { /* already exited */ }
        try { opusStream.destroy(); } catch { /* already closed */ }
    });

    return { stream: opusStream, cleanup };
}
