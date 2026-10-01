import { EventEmitter } from 'events';
import {
    type Stream,
    AV_DICT_MATCH_CASE,
    Log as FFmpegLog,
    AV_LOG_ERROR,
    Demuxer,
    Dictionary,
    type AVDisposition,
    type AVCodecID,
} from 'node-av';
import { type MediaInfoTrackMap } from '@app/mediainfo';
import {
    type VideoModify,
    type AudioModify,
    type SubtitleModify,
    type VideoPreprocess,
    type AudioPreprocess,
} from '../episode/types.js';
import { type StreamProperties, extractNativeStreamProperties } from '../episode/stream-props.js';
import { modifyStream } from '../modifier/index.js';
import { pipeAudioToOpusenc } from '../encoders/opusenc.js';
import { listDispositions } from '../sorter/index.js';
import { getCodecName } from '../ffmpeg/codec-names.js';
import { getDispositionName, type DispositionState } from '../ffmpeg/dispositions.js';
import { acquireFfmpegSemaphore, releaseFfmpegSemaphore } from '../ffmpeg/concurrency.js';

// Suppress FFmpeg warnings
FFmpegLog.setLevel(AV_LOG_ERROR);

// #region Types

export interface SelectedStream<TModify = never, TPreprocess = never> {
    stream: Stream;
    modify?: TModify;
    preprocess?: TPreprocess;
}

export interface ProcessedStream<TModify = never> {
    stream: Stream;
    originalIndex: number;
    demuxerMapKey: string;
    modify?: TModify;
    originalMetadata?: Dictionary | null;
    originalCodec?: AVCodecID;
    originalDispositions?: AVDisposition[];
}

export type ProcessedVideoStream = ProcessedStream<VideoModify>;
export type ProcessedAudioStream = ProcessedStream<AudioModify>;
export type ProcessedSubtitleStream = ProcessedStream<SubtitleModify>;

// #endregion Types

// #region Event Interfaces

export interface PreprocessingInitEvent {
    streams: { streamIndex: number; sourcePath: string }[];
}

export interface ProgressEvent {
    streamIndex: number;
    progress: number;
    sourcePath: string;
}

export interface PreprocessingCompleteEvent {
    totalStreams: number;
}

// #endregion Event Interfaces

// #region matchSelector

export function matchSelector<T>(selector: unknown, value: T): boolean {
    if (selector == null) return true;
    if (typeof selector === 'object' && selector !== null) {
        const sel = selector as Record<string, unknown>;
        if ('equal' in sel) return value === sel.equal;
        if ('not' in sel) return !matchSelector(sel.not, value);
        if ('allOf' in sel && Array.isArray(sel.allOf)) return sel.allOf.every((s: unknown) => matchSelector(s, value));
        if ('anyOf' in sel && Array.isArray(sel.anyOf)) return sel.anyOf.some((s: unknown) => matchSelector(s, value));
        if ('oneOf' in sel && Array.isArray(sel.oneOf)) return sel.oneOf.filter((s: unknown) => matchSelector(s, value)).length === 1;
        if ('greaterThan' in sel && typeof value === 'number') return value > (sel.greaterThan as number);
        if ('lessThan' in sel && typeof value === 'number') return value < (sel.lessThan as number);
        if ('pattern' in sel) {
            const patternVal = sel.pattern;
            const flags = 'patternFlags' in sel ? String(sel.patternFlags) : '';
            let regex: RegExp;
            if (patternVal instanceof RegExp) {
                regex = patternVal;
            } else {
                try {
                    regex = new RegExp(String(patternVal), flags);
                } catch {
                    return false;
                }
            }
            return regex.test(String(value));
        }
        if ('contains' in sel) return String(value).includes(String(sel.contains));
        if ('startsWith' in sel) return String(value).startsWith(String(sel.startsWith));
        if ('endsWith' in sel) return String(value).endsWith(String(sel.endsWith));
    }
    return false;
}

// #endregion matchSelector

// #region evaluateStreamMatch — shared match evaluation

/**
 * Evaluate a stream match schema against extracted stream properties.
 *
 * This is the shared evaluation used by both the real BaseSelector and the
 * simulator. It operates on StreamProperties (which can come from a live
 * node-av Stream or from cached StreamInfo data) to ensure identical matching.
 *
 * Supported properties: index, codec, title, language, disposition, duration,
 * width, height, channels, bitrate, size, fileName, mimeType, tags.
 */
export function evaluateStreamMatch(
    match: Record<string, unknown>,
    props: StreamProperties,
): boolean {
    return Object.entries(match).every(([prop, schema]) => {
        switch (prop) {
            case 'index': return matchSelector(schema, props.index);
            case 'codec': {
                if (matchSelector(schema, props.codecId)) return true;
                if (props.codecName && matchSelector(schema, props.codecName)) return true;
                return false;
            }
            case 'title': return matchSelector(schema, props.title);
            case 'language': return matchSelector(schema, props.language);
            case 'disposition': {
                return Object.entries(schema as DispositionState).every(
                    ([disp, val]) => matchSelector(val, props.hasDisposition(Number(disp) as AVDisposition)),
                );
            }
            case 'duration': return matchSelector(schema, props.duration);
            case 'width': return matchSelector(schema, props.width);
            case 'height': return matchSelector(schema, props.height);
            case 'channels': return matchSelector(schema, props.channels);
            case 'bitrate': return matchSelector(schema, props.bitRate);
            case 'size': {
                const bitRate = props.bitRate ?? 0;
                const duration = props.duration ?? 0;
                return matchSelector(schema, bitRate * duration);
            }
            case 'fileName': return matchSelector(schema, props.metadata['filename']);
            case 'mimeType': return matchSelector(schema, props.metadata['mimetype']);
            case 'tags': {
                return Object.entries(schema as Record<string, unknown>).every(
                    ([key, val]) => matchSelector(val, props.metadata[key]),
                );
            }
            default: {
                throw new Error(`Unknown selector property: ${prop}`);
            }
        }
    });
}

// #endregion evaluateStreamMatch

/**
 * Merge a per-track modifier on top of a match-item modify block.
 * Per-track values always win. For disposition, the merge is deep
 * (per-track disposition keys override item-level ones).
 */
export function mergeTrackModifier(base: Record<string, unknown>, override: PerTrackModifier): Record<string, unknown> {
    const result = { ...base };
    if (override.title !== undefined) result.title = override.title;
    if (override.language !== undefined) result.language = override.language;
    if (override.delay !== undefined) result.delay = override.delay;
    if (override.tags !== undefined) result.tags = { ...(result.tags as Record<string, string> ?? {}), ...override.tags };
    if (override.disposition !== undefined) {
        result.disposition = { ...(result.disposition as Record<string, boolean> ?? {}), ...override.disposition };
    }
    // Explicit `!== undefined` so an explicit `false` override wins over the default.
    if (override.compress !== undefined) result.compress = override.compress;
    return result;
}

/** Per-track modifier shape for inline overrides. */
export interface PerTrackModifier {
    title?: string;
    language?: string;
    delay?: number;
    disposition?: Record<string, boolean>;
    tags?: Record<string, string>;
    /** Overrides `modify.compress` for this track. Undefined means "inherit". */
    compress?: boolean;
}

export abstract class BaseSelector<
    TModify = never,
    TPreprocess = never,
> extends EventEmitter {
    protected demuxerStack: AsyncDisposableStack;
    protected demuxerMap: Map<string, Demuxer>;
    public readonly filePath: string;
    protected readonly streams: Stream[];
    protected readonly selectors: unknown[];
    public readonly mediaInfo?: MediaInfoTrackMap;
    /** Per-track modifiers keyed by stream index. Merged on top of match-item modify blocks. */
    protected readonly perTrackModifiers?: Record<number, PerTrackModifier>;
    /** Excluded track indices (stream indices) that are skipped during selection. */
    protected readonly excludedTracks?: ReadonlySet<number>;
    /** Callback to register background tasks for cleanup during disposal/cancellation. */
    protected readonly registerBackgroundTask?: (cleanup: () => Promise<void>) => void;

    constructor(
        demuxerStack: AsyncDisposableStack,
        demuxerMap: Map<string, Demuxer>,
        filePath: string,
        streams: Stream[],
        selectors: unknown[],
        mediaInfo?: MediaInfoTrackMap,
        /** Per-track modifiers keyed by stream index. Merged on top of match-item modify blocks. */
        perTrackModifiers?: Record<number, PerTrackModifier>,
        /** Excluded track indices (stream indices) that are skipped during selection. */
        excludedTracks?: number[],
        /** Callback to register background tasks for cleanup during disposal/cancellation. */
        registerBackgroundTask?: (cleanup: () => Promise<void>) => void,
    ) {
        super();
        this.demuxerStack = demuxerStack;
        this.demuxerMap = demuxerMap;
        this.filePath = filePath;
        this.streams = streams;
        this.selectors = selectors;
        this.mediaInfo = mediaInfo;
        this.perTrackModifiers = perTrackModifiers;
        this.excludedTracks = excludedTracks && excludedTracks.length > 0 ? new Set(excludedTracks) : undefined;
        this.registerBackgroundTask = registerBackgroundTask;
    }

    public async select(): Promise<SelectedStream<TModify, TPreprocess>[]> {
        const demuxer = this.demuxerMap.get(this.filePath);

        const selectedStreams = this.streams.reduce((filteredStreams, stream) => {
            // Skip explicitly excluded tracks (applies regardless of whether selectors exist)
            if (this.excludedTracks?.has(stream.index)) {
                return filteredStreams;
            }

            // If no selectors, include all non-excluded streams
            if (!this.selectors || this.selectors.length === 0) {
                return filteredStreams.concat({ stream });
            }

            const props = extractNativeStreamProperties(stream, demuxer, this.mediaInfo);

            const matches = this.selectors.filter((sel: unknown) => {
                if (!sel || typeof sel !== 'object') return true;
                const selector = sel as Record<string, unknown>;
                if (!('match' in selector) || !selector.match) return true;
                return evaluateStreamMatch(selector.match as Record<string, unknown>, props);
            });

            return filteredStreams.concat(
                matches.map((selector: unknown) => {
                    const { modify, preprocess } = selector as { match: unknown, modify?: TModify, preprocess?: TPreprocess };
                    // Merge per-track modifier on top of match-item modify (per-track wins)
                    const trackMod = this.perTrackModifiers?.[stream.index];
                    const mergedModify = (trackMod && modify)
                        ? mergeTrackModifier(modify as Record<string, unknown>, trackMod) as TModify
                        : trackMod
                            ? trackMod as unknown as TModify
                            : modify;
                    return { stream, modify: mergedModify, preprocess };
                }),
            );
        }, [] as SelectedStream<TModify, TPreprocess>[]);

        return selectedStreams;
    }

    public async process(selectedStreams: SelectedStream<TModify, TPreprocess>[]): Promise<ProcessedStream<TModify>[]> {
        // Emit initialization event with list of streams that will be preprocessed
        const streamsToPreprocess = selectedStreams.filter(({ preprocess }) => preprocess);

        if (streamsToPreprocess.length > 0) {
            this.emit('preprocessing:init', {
                streams: streamsToPreprocess.map(({ stream }) => ({
                    streamIndex: stream.index,
                    sourcePath: this.filePath,
                })),
            } as PreprocessingInitEvent);
        }

        const results = await Promise.all(selectedStreams.map(async ({ stream, modify, preprocess }) => {
            // Ensure precise BCP 47 language code from MediaInfo propagates to native
            const props = extractNativeStreamProperties(stream, this.demuxerMap.get(this.filePath), this.mediaInfo);
            const originalLanguage = props.language;
            if (originalLanguage) {
                const existing = stream.metadata?.getAll() ?? {};
                stream.metadata = Dictionary.fromObject({
                    ...existing,
                    language: originalLanguage,
                });
            }
            const originalMetadata = stream.metadata;
            const originalDispositions = listDispositions(stream);
            if (preprocess) {
                const preprocessedStream = await this.preprocess(stream, preprocess);
                return {
                    originalIndex: stream.index,
                    originalCodec: stream.codecpar.codecId,
                    demuxerMapKey: `${this.filePath}:preprocess:${stream.index}`,
                    ...modify
                        ? {
                            stream: modifyStream(preprocessedStream, modify),
                            modify,
                            originalMetadata,
                            originalDispositions,
                        } : {
                            stream: preprocessedStream,
                        },
                };
            }

            return {
                stream: modify ? modifyStream(stream, modify) : stream,
                originalIndex: stream.index,
                demuxerMapKey: this.filePath,
                ...modify && {
                    modify,
                    originalMetadata,
                    originalDispositions,
                },
            };
        }));

        // Emit completion event
        if (streamsToPreprocess.length > 0) {
            this.emit('preprocessing:complete', {
                totalStreams: streamsToPreprocess.length,
            } as PreprocessingCompleteEvent);
        }

        return results;
    }

    abstract preprocess(stream: Stream, preprocess: TPreprocess): Promise<Stream> | never;
}

export class VideoSelector extends BaseSelector<VideoModify, VideoPreprocess> {
    async preprocess(stream: Stream, preprocess: VideoPreprocess): Promise<Stream> {
        if (Object.keys(preprocess).length === 0) return stream;

        if (preprocess.grav1synth) {
            // Grav1synth not supported yet
            return stream;
        }

        return stream;
    }
}

export class AudioSelector extends BaseSelector<AudioModify, AudioPreprocess> {
    async preprocess(stream: Stream, preprocess: AudioPreprocess): Promise<Stream> {
        if (Object.keys(preprocess).length === 0) return stream;

        if (preprocess.opusenc) {
            // Get a readable stream from opusenc (with internal stderr progress parsing)
            // The onProgress callback is no longer needed here since opusenc parses
            // its own stderr for progress data.
            const { stream: opusReadable, cleanup } = await pipeAudioToOpusenc(this.filePath, stream.index, preprocess.opusenc);

            // Register the cleanup function so that the background pipeline
            // is stopped before demuxers are disposed during cancellation.
            if (this.registerBackgroundTask) {
                this.registerBackgroundTask(cleanup);
            }

            // Wrap Demuxer.open() to include source file context in the error.
            await acquireFfmpegSemaphore();
            let rawDemuxer: Demuxer;
            try {
                rawDemuxer = await Demuxer.open(opusReadable, { format: 'ogg' });
            } finally {
                releaseFfmpegSemaphore();
            }
            let opusDemuxer: Demuxer;
            try {
                opusDemuxer = this.demuxerStack.use(rawDemuxer);
            } catch (error) {
                throw new Error(
                    `Failed to open Opus-encoded stream for "${this.filePath}"` +
                    ` stream index ${stream.index}: ${error instanceof Error ? error.message : String(error)}`,
                    { cause: error },
                );
            }
            const opusStream = opusDemuxer.audio();
            if (!opusStream) throw new Error('No Opus stream found in opusenc output.');

            // Merge metadata
            opusStream.metadata = Dictionary.fromObject({ ...stream.metadata?.getAll(), ...opusStream.metadata?.getAll() });
            // Store the opus demuxer reference for packet writing
            this.demuxerMap.set(`${this.filePath}:preprocess:${stream.index}`, opusDemuxer);

            return opusStream;
        }

        return stream;
    }
}

export class SubtitleSelector extends BaseSelector<SubtitleModify, never> {
    preprocess(_stream: Stream, _preprocess: never): never {
        throw new Error('Subtitle streams cannot be preprocessed.');
    }
}

export class AttachmentSelector extends BaseSelector<never, never> {
    preprocess(_stream: Stream, _preprocess: never): never {
        throw new Error('Attachment streams cannot be preprocessed.');
    }
}

export function getStreamChanges(stream: Stream, originalMetadata?: Dictionary | null, originalDispositions?: AVDisposition[], originalCodec?: AVCodecID): string {
    const previousTitle = originalMetadata?.get('title', AV_DICT_MATCH_CASE) ?? 'N/A';
    const previousLanguage = originalMetadata?.get('language', AV_DICT_MATCH_CASE) ?? 'N/A';
    const previousDispositions = originalDispositions ? originalDispositions.map(disposition => getDispositionName(disposition)) : [];
    const previousCodec = originalCodec ? getCodecName(originalCodec) : undefined;

    const currentTitle = stream.metadata?.get('title', AV_DICT_MATCH_CASE) ?? 'N/A';
    const currentLanguage = stream.metadata?.get('language', AV_DICT_MATCH_CASE) ?? 'N/A';
    const currentDispositions = listDispositions(stream).map(disposition => getDispositionName(disposition));
    const currentCodec = getCodecName(stream.codecpar.codecId);

    function getInfo(codec: string | undefined | null, title: string, language: string, dispositions: (string | undefined)[]): string {
        return `Codec=${codec ?? 'N/A'} Title=${title} Language=${language} Dispositions=${dispositions.join(', ')}`;
    }

    return `${getInfo(previousCodec ?? currentCodec, previousTitle, previousLanguage, previousDispositions)} -> ${getInfo(currentCodec, currentTitle, currentLanguage, currentDispositions)}`;
}
