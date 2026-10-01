import EventEmitter from 'node:events';
import * as fs from 'fs';
import path from 'node:path';
import sanitize from 'sanitize-filename';
import { acquireFfmpegSemaphore, releaseFfmpegSemaphore } from '../ffmpeg/concurrency.js';

import {
    AVMEDIA_TYPE_ATTACHMENT,
    AVMEDIA_TYPE_AUDIO,
    AVMEDIA_TYPE_SUBTITLE,
    AVMEDIA_TYPE_VIDEO,
    AV_LOG_ERROR,
    AVDISCARD_ALL,
    Demuxer,
    Dictionary,
    Log as FFmpegLog,
    Muxer,
    AV_NOPTS_VALUE,
} from 'node-av';
import {
    AttachmentSelector,
    AudioSelector,
    type ProcessedAudioStream,
    type ProcessedStream,
    type ProcessedSubtitleStream,
    type ProcessedVideoStream,
    SubtitleSelector,
    VideoSelector,
} from '../selector/index.js';
import { Logger } from '@app/utils';
import { getStreamTracks, type MediaInfoTrackMap } from '@app/mediainfo';
import { DEFAULT_FILENAME_TEMPLATE, templateFileName } from '../@utils/filename-template.js';
import { sortStreams, listDispositions } from '../sorter/index.js';
import { getCodecName } from '../ffmpeg/codec-names.js';
import { getDispositionName } from '../ffmpeg/dispositions.js';
import { muxWithFFmpeg } from '../ffmpeg/muxer.js';
import { MinHeap } from '../@utils/min-heap.js';
import {
    getStreamKey,
    buildWriteKey,
    SyncPacketBucket,
    DemuxPacketReader,
    type WriteContext,
    type HeapEntry,
} from '../@utils/merge-streams.js';
import {
    MuxProgressTracker,
    type CodecType,
    type TrackComparison,
    resolveSourceKey,
    sourceNameFromKey,
} from './progress.js';
import {
    type Episode,
    type SkippedEvent,
    type NativeMultiplexer,
} from './types.js';
export * from './types.js';
export * from './progress.js';

const log = new Logger('EpisodeMuxer');

export class EpisodeMuxer extends EventEmitter implements AsyncDisposable {
    private readonly demuxerStack = new AsyncDisposableStack();
    private demuxerMap = new Map<string, Demuxer>(); // key: sourcePath
    private readonly selectors: { video: VideoSelector[]; audio: AudioSelector[]; subtitle: SubtitleSelector[]; attachment: AttachmentSelector[] } = {
        video: [],
        audio: [],
        subtitle: [],
        attachment: [],
    };
    private readonly preprocessedVideoStreams: (ProcessedVideoStream & { filePath: string })[] = [];
    private readonly preprocessedAudioStreams: (ProcessedAudioStream & { filePath: string })[] = [];
    private readonly preprocessedSubtitleStreams: (ProcessedSubtitleStream & { filePath: string })[] = [];
    private readonly preprocessedAttachmentStreams: (ProcessedStream & { filePath: string })[] = [];

    private abortController: AbortController | undefined;
    private preprocessAbortController: AbortController | undefined;

    /**
     * 0-based output track indices of subtitle tracks that should be zlib-compressed,
     * resolved during `mux()`. Consumed by the mkvmerge post-process, which is the only
     * place compression can be applied — FFmpeg's Matroska muxer cannot write the EBML
     * `ContentEncodings` element.
     */
    compressibleSubtitleTrackIds: number[] = [];

    /**
     * Background tasks (e.g. opusenc pipelines) that must be cleaned up
     * before disposing demuxers. Each task is an async function that stops
     * subprocesses and waits for the pipeline to finish.
     */
    private readonly backgroundTasks: Array<() => Promise<void>> = [];

    private readonly episode: Episode;

    private constructor(episode: Episode) {
        super();
        this.episode = episode;
    }

    async [Symbol.asyncDispose](): Promise<void> {
        log.debug('asyncDispose: cleaning up background tasks');
        // Clean up background tasks first to avoid a race condition where
        // a background pipeline continues using native FFmpeg resources
        // after demuxers are disposed.
        for (const task of this.backgroundTasks) {
            try {
                await task();
            } catch {
                // Ignore errors during cleanup — the task's catch block
                // handles resource disposal.
            }
        }
        log.debug('asyncDispose: disposing demuxerStack');
        await this.demuxerStack.disposeAsync();
    }

    /**
     * Register a background task for cleanup during disposal or cancellation.
     * Used by opusenc pipelines to ensure they stop before demuxers are disposed.
     */
    registerBackgroundTask(cleanup: () => Promise<void>): void {
        this.backgroundTasks.push(cleanup);
    }

    private static sourcePath(source: Episode['sources'][0]): string {
        return path.resolve(source.file.directory, source.file.name);
    }

    private outputDirectory(): string {
        return this.episode.file.directory;
    }

    private outputPath(fileName: string): string {
        return path.resolve(this.outputDirectory(), `${fileName}.mkv`);
    }

    /**
     * Delete a partially-written output file. The output is written directly
     * to the final path via custom IO callbacks, so on cancel/error the
     * incomplete .mkv must be removed to avoid leaving corrupt files behind.
     */
    private removeOutputFile(filePath: string): void {
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            log.debug('removed incomplete output file:', { filePath });
        } catch (err) {
            log.warn('failed to remove incomplete output file:', {
                filePath,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    // #region Initialization

    public static async init(episode: Episode): Promise<EpisodeMuxer> {
        const episodeMuxer = new EpisodeMuxer(episode);

        try {
            for (const source of episodeMuxer.episode.sources) {
                const sourcePathStr = EpisodeMuxer.sourcePath(source);
                await acquireFfmpegSemaphore();
                let demuxer;
                try {
                    demuxer = episodeMuxer.demuxerStack.use(await Demuxer.open(sourcePathStr));
                } finally {
                    releaseFfmpegSemaphore();
                }
                episodeMuxer.demuxerMap.set(sourcePathStr, demuxer);
            }

            await Promise.all(episodeMuxer.episode.sources.map(async source => {
                const sourcePathStr = EpisodeMuxer.sourcePath(source);
                const demuxer = episodeMuxer.demuxerMap.get(sourcePathStr)!;

                let mediaInfo: MediaInfoTrackMap | undefined;
                try {
                    mediaInfo = await getStreamTracks(sourcePathStr);
                } catch {
                    mediaInfo = undefined;
                }
                const perTrackMods = source.perTrackModifiers;
                const excludedTracks = source.excludedTracks;

                episodeMuxer.selectors.video.push(new VideoSelector(
                    episodeMuxer.demuxerStack, episodeMuxer.demuxerMap, sourcePathStr,
                    demuxer.streams.filter(stream => stream.codecpar.codecType === AVMEDIA_TYPE_VIDEO),
                    source.video ?? [], mediaInfo, perTrackMods, excludedTracks,
                    (cleanup) => episodeMuxer.registerBackgroundTask(cleanup),
                ));
                episodeMuxer.selectors.audio.push(new AudioSelector(
                    episodeMuxer.demuxerStack, episodeMuxer.demuxerMap, sourcePathStr,
                    demuxer.streams.filter(stream => stream.codecpar.codecType === AVMEDIA_TYPE_AUDIO),
                    source.audio ?? [], mediaInfo, perTrackMods, excludedTracks,
                    (cleanup) => episodeMuxer.registerBackgroundTask(cleanup),
                ));
                episodeMuxer.selectors.subtitle.push(new SubtitleSelector(
                    episodeMuxer.demuxerStack, episodeMuxer.demuxerMap, sourcePathStr,
                    demuxer.streams.filter(stream => stream.codecpar.codecType === AVMEDIA_TYPE_SUBTITLE),
                    source.subtitle ?? [], mediaInfo, perTrackMods, excludedTracks,
                    (cleanup) => episodeMuxer.registerBackgroundTask(cleanup),
                ));
                episodeMuxer.selectors.attachment.push(new AttachmentSelector(
                    episodeMuxer.demuxerStack, episodeMuxer.demuxerMap, sourcePathStr,
                    demuxer.streams.filter(stream => stream.codecpar.codecType === AVMEDIA_TYPE_ATTACHMENT),
                    source.attachment ?? [], mediaInfo, undefined, excludedTracks,
                    (cleanup) => episodeMuxer.registerBackgroundTask(cleanup),
                ));
            }));
        } catch (error) {
            if (error instanceof EpisodeMuxerError) {
                log.error('EpisodeMuxer init failed:', {
                    sourcePath: error.sourcePath,
                    error: error.message,
                });
                throw error;
            }
            const sourcePath = path.resolve(episode.file.directory, episode.file.name);
            log.error('EpisodeMuxer init failed:', {
                sourcePath,
                error: error instanceof Error ? error.message : String(error),
            });
            throw new EpisodeMuxerError(
                `Failed to initialize EpisodeMuxer: ${error instanceof Error ? error.message : String(error)}`,
                sourcePath,
                error instanceof Error ? { cause: error } : undefined,
            );
        }

        return episodeMuxer;
    }

    // #endregion Initialization

    // #region Preprocessing

    async preprocess(): Promise<void> {
        if (this.preprocessedVideoStreams.length || this.preprocessedAudioStreams.length ||
            this.preprocessedSubtitleStreams.length || this.preprocessedAttachmentStreams.length) {
            return;
        }

        // Set up an AbortController for preprocessing so that cancel() can
        // signal background tasks (e.g. opusenc pipelines) to stop.
        this.preprocessAbortController = new AbortController();
        try {
            await this.runPreprocess();
        } finally {
            this.preprocessAbortController = undefined;
        }
    }

    private async runPreprocess(): Promise<void> {
        const epLabel = `S${String(this.episode.series.season.number).padStart(2, '0')}E${String(this.episode.series.episode.number).padStart(2, '0')}`;

        const runVideos = async (): Promise<void> => {
            const results = await Promise.all(this.selectors.video.map(async s => {
                const selected = await s.select();
                const processed = await s.process(selected);
                return processed.map(stream => ({ ...stream, filePath: s.filePath }));
            }));
            (this.preprocessedVideoStreams as (ProcessedVideoStream & { filePath: string })[]).push(...results.flat());
        };

        const runAudios = async (): Promise<void> => {
            const results = await Promise.all(this.selectors.audio.map(async s => {
                const selected = await s.select();
                const processed = await s.process(selected);
                return processed.map(stream => ({ ...stream, filePath: s.filePath }));
            }));
            (this.preprocessedAudioStreams as (ProcessedAudioStream & { filePath: string })[]).push(...results.flat());
        };

        const runSubtitles = async (): Promise<void> => {
            const results = await Promise.all(this.selectors.subtitle.map(async s => {
                const selected = await s.select();
                const processed = await s.process(selected);
                return processed.map(stream => ({ ...stream, filePath: s.filePath }));
            }));
            (this.preprocessedSubtitleStreams as (ProcessedSubtitleStream & { filePath: string })[]).push(...results.flat());
        };

        const runAttachments = async (): Promise<void> => {
            const results = await Promise.all(this.selectors.attachment.map(async s => {
                const selected = await s.select();
                return selected.map(stream => ({
                    stream: stream.stream,
                    originalIndex: stream.stream.index,
                    demuxerMapKey: s.filePath,
                    filePath: s.filePath,
                }));
            }));
            (this.preprocessedAttachmentStreams as (ProcessedStream & { filePath: string })[]).push(...results.flat());
        };

        try { await runVideos(); } catch (error) {
            throw new EpisodeMuxerError(`Video preprocessing failed for "${this.episode.series.name}" ${epLabel}: ${error instanceof Error ? error.message : String(error)}`, '', { cause: error instanceof Error ? error : undefined });
        }
        try { await runAudios(); } catch (error) {
            throw new EpisodeMuxerError(`Audio preprocessing failed for "${this.episode.series.name}" ${epLabel}: ${error instanceof Error ? error.message : String(error)}`, '', { cause: error instanceof Error ? error : undefined });
        }
        try { await runSubtitles(); } catch (error) {
            throw new EpisodeMuxerError(`Subtitle preprocessing failed for "${this.episode.series.name}" ${epLabel}: ${error instanceof Error ? error.message : String(error)}`, '', { cause: error instanceof Error ? error : undefined });
        }
        try { await runAttachments(); } catch (error) {
            throw new EpisodeMuxerError(`Attachment preprocessing failed for "${this.episode.series.name}" ${epLabel}: ${error instanceof Error ? error.message : String(error)}`, '', { cause: error instanceof Error ? error : undefined });
        }
    }

    // #endregion Preprocessing

    // #region Progress API

    /**
     * Cancel the current mux or preprocessing operation.
     * Aborts both the mux and preprocess AbortControllers, and triggers
     * cleanup of background tasks (e.g. opusenc pipelines).
     */
    cancel(reason?: string): void {
        this.abortController?.abort(reason);
        this.preprocessAbortController?.abort(reason);

        // Trigger cleanup of background tasks. We don't await here because
        // cancel() is synchronous — the cleanup will run concurrently.
        for (const task of this.backgroundTasks) {
            void task().catch(() => { /* ignore */ });
        }
    }

    // #endregion Progress API

    // #region Mux (Streaming k-way merge)

    async mux(options?: { method?: NativeMultiplexer; overwrite?: boolean }): Promise<string | undefined> {
        const videoStreams = this.preprocessedVideoStreams;
        const audioStreams = this.preprocessedAudioStreams;
        const subtitleStreams = this.preprocessedSubtitleStreams;
        const attachmentStreams = this.preprocessedAttachmentStreams;

        if (!videoStreams.length && !audioStreams.length && !subtitleStreams.length && !attachmentStreams.length) {
            return undefined;
        }

        sortStreams(videoStreams as (ProcessedStream & { filePath: string })[]);
        sortStreams(audioStreams as (ProcessedStream & { filePath: string })[]);
        sortStreams(subtitleStreams as (ProcessedStream & { filePath: string })[]);

        const directory = this.outputDirectory();
        const fileName = sanitize(templateFileName(
            this.episode.file.rename?.template ?? DEFAULT_FILENAME_TEMPLATE,
            this.episode.series,
            videoStreams[0]?.stream,
            audioStreams.map(({ stream }) => stream),
            subtitleStreams.map(({ stream }) => stream),
            this.episode.file.rename?.tags,
            this.episode.file.rename?.fieldConfig,
        ));

        if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });

        const overwrite = options?.overwrite ?? this.episode.file.overwrite ?? false;
        if (!overwrite) {
            if (fs.existsSync(this.outputPath(fileName))) {
                this.emit('skipped', { reason: 'already exists', fileName } as SkippedEvent);
                return undefined;
            }
        }

        const method = options?.method ?? this.episode.method;
        if ('tempDir' in method) {
            this.emit('ffmpeg:start', { command: 'ffmpeg', args: [] });
            return muxWithFFmpeg(
                this.episode,
                this.preprocessedVideoStreams,
                this.preprocessedAudioStreams,
                this.preprocessedSubtitleStreams,
                this.preprocessedAttachmentStreams,
                this.demuxerMap,
                method.tempDir,
                fileName,
            );
        }

        const nodeAVOptions = method as NativeMultiplexer;

        const outputIndexMap: Map<string, number> = new Map();
        const output = await Muxer.open(this.outputPath(fileName), {
            options: { avoid_negative_ts: 'make_zero' },
        });
        FFmpegLog.setLevel(AV_LOG_ERROR);

        output.getFormatContext().metadata = Dictionary.fromObject({
            ...{ title: this.episode.series.episode.name ?? this.episode.series.name },
            ...this.episode.modifyTags,
        });

        // Build track comparisons + codec type map
        const trackComparisons: TrackComparison[] = [];
        const streamCodecTypes = new Map<string, CodecType>();
        const sourceNames = new Map<string, string>();

        const addVideoStreams = (): void => {
            videoStreams.forEach(({ stream, demuxerMapKey, originalIndex, originalMetadata, originalDispositions, originalCodec }) => {
                const outputIndex = output.addStream(stream);
                const streamKey = getStreamKey(demuxerMapKey, originalIndex);
                outputIndexMap.set(streamKey, outputIndex);
                streamCodecTypes.set(streamKey, 'video');
                if (!sourceNames.has(demuxerMapKey)) {
                    sourceNames.set(demuxerMapKey, sourceNameFromKey(demuxerMapKey));
                }
                trackComparisons.push({
                    outputIndex,
                    codecType: 'video',
                    demuxerMapKey,
                    originalIndex,
                    originalCodec: originalCodec ? getCodecName(originalCodec) ?? 'unknown' : getCodecName(stream.codecpar.codecId) ?? 'unknown',
                    originalTitle: originalMetadata?.get('title') ?? undefined,
                    originalLanguage: originalMetadata?.get('language') ?? undefined,
                    originalDispositions: originalDispositions?.map(getDispositionName).filter((d): d is string => d !== undefined) ?? [],
                    muxedCodec: getCodecName(stream.codecpar.codecId) ?? 'unknown',
                    muxedTitle: stream.metadata?.get('title') ?? undefined,
                    muxedLanguage: stream.metadata?.get('language') ?? undefined,
                    muxedDispositions: listDispositions(stream).map(getDispositionName).filter((d): d is string => d !== undefined),
                    muxedFilename: stream.metadata?.get('filename') ?? undefined,
                    muxedMimetype: stream.metadata?.get('mimetype') ?? undefined,
                });
            });
        };
        const addAudioStreams = (): void => {
            audioStreams.forEach(({ stream, demuxerMapKey, originalIndex, originalMetadata, originalDispositions, originalCodec, modify }) => {
                const outputIndex = output.addStream(stream);
                const streamKey = getStreamKey(demuxerMapKey, originalIndex);
                outputIndexMap.set(streamKey, outputIndex);
                streamCodecTypes.set(streamKey, 'audio');
                if (!sourceNames.has(demuxerMapKey)) {
                    sourceNames.set(demuxerMapKey, sourceNameFromKey(demuxerMapKey));
                }
                trackComparisons.push({
                    outputIndex,
                    codecType: 'audio',
                    demuxerMapKey,
                    originalIndex,
                    originalCodec: originalCodec ? getCodecName(originalCodec) ?? 'unknown' : getCodecName(stream.codecpar.codecId) ?? 'unknown',
                    originalTitle: originalMetadata?.get('title') ?? undefined,
                    originalLanguage: originalMetadata?.get('language') ?? undefined,
                    originalDispositions: originalDispositions?.map(getDispositionName).filter((d): d is string => d !== undefined) ?? [],
                    muxedCodec: getCodecName(stream.codecpar.codecId) ?? 'unknown',
                    muxedTitle: stream.metadata?.get('title') ?? undefined,
                    muxedLanguage: stream.metadata?.get('language') ?? undefined,
                    muxedDispositions: listDispositions(stream).map(getDispositionName).filter((d): d is string => d !== undefined),
                    muxedFilename: stream.metadata?.get('filename') ?? undefined,
                    muxedMimetype: stream.metadata?.get('mimetype') ?? undefined,
                    muxedDelay: modify?.delay ?? 0,
                });
            });
        };
        const addSubtitleStreams = (): void => {
            subtitleStreams.forEach(({ stream, demuxerMapKey, originalIndex, originalMetadata, originalDispositions, originalCodec, modify }) => {
                const outputIndex = output.addStream(stream);
                const streamKey = getStreamKey(demuxerMapKey, originalIndex);
                outputIndexMap.set(streamKey, outputIndex);
                streamCodecTypes.set(streamKey, 'subtitle');
                if (!sourceNames.has(demuxerMapKey)) {
                    sourceNames.set(demuxerMapKey, sourceNameFromKey(demuxerMapKey));
                }
                trackComparisons.push({
                    outputIndex,
                    codecType: 'subtitle',
                    demuxerMapKey,
                    originalIndex,
                    originalCodec: originalCodec ? getCodecName(originalCodec) ?? 'unknown' : getCodecName(stream.codecpar.codecId) ?? 'unknown',
                    originalTitle: originalMetadata?.get('title') ?? undefined,
                    originalLanguage: originalMetadata?.get('language') ?? undefined,
                    originalDispositions: originalDispositions?.map(getDispositionName).filter((d): d is string => d !== undefined) ?? [],
                    muxedCodec: getCodecName(stream.codecpar.codecId) ?? 'unknown',
                    muxedTitle: stream.metadata?.get('title') ?? undefined,
                    muxedLanguage: stream.metadata?.get('language') ?? undefined,
                    muxedDispositions: listDispositions(stream).map(getDispositionName).filter((d): d is string => d !== undefined),
                    muxedFilename: stream.metadata?.get('filename') ?? undefined,
                    muxedMimetype: stream.metadata?.get('mimetype') ?? undefined,
                    muxedDelay: modify?.delay ?? 0,
                    muxCompress: modify?.compress ?? true,
                });
            });
        };
        const addAttachmentStreams = (): void => {
            attachmentStreams.forEach(({ stream, demuxerMapKey, originalIndex }) => {
                const outputIndex = output.addStream(stream);
                const streamKey = getStreamKey(demuxerMapKey, originalIndex);
                outputIndexMap.set(streamKey, outputIndex);
                streamCodecTypes.set(streamKey, 'attachment');
                if (!sourceNames.has(demuxerMapKey)) {
                    sourceNames.set(demuxerMapKey, sourceNameFromKey(demuxerMapKey));
                }
            });
        };

        addVideoStreams();
        addAudioStreams();
        addSubtitleStreams();
        addAttachmentStreams();

        this.emit('tracks:ready', trackComparisons);

        // Record which subtitle tracks want zlib compression. Resolved here because
        // `outputIndex` is only known after addStream; the mkvmerge post-process needs
        // these to emit `--compression TID:zlib`. Bitmap subtitle codecs are filtered
        // out later, when the muxed file is probed by mkvmerge.
        this.compressibleSubtitleTrackIds = trackComparisons
            .filter(t => t.codecType === 'subtitle' && (t.muxCompress ?? true))
            .map(t => t.outputIndex);

        // Phase 2: Streaming k-way merge

        const streamDelayMap = new Map<string, number>();
        for (const { demuxerMapKey, originalIndex, modify } of audioStreams) {
            streamDelayMap.set(getStreamKey(demuxerMapKey, originalIndex), (modify?.delay ?? 0) / 1000);
        }
        for (const { demuxerMapKey, originalIndex, modify } of subtitleStreams) {
            streamDelayMap.set(getStreamKey(demuxerMapKey, originalIndex), (modify?.delay ?? 0) / 1000);
        }

        const activeDemuxerKeys = new Set<string>();
        for (const { demuxerMapKey } of [...videoStreams, ...audioStreams, ...subtitleStreams, ...attachmentStreams]) {
            activeDemuxerKeys.add(demuxerMapKey);
        }

        const writeContextMap = new Map<string, WriteContext>();

        for (const { demuxerMapKey, originalIndex } of [...videoStreams, ...audioStreams, ...subtitleStreams, ...attachmentStreams]) {
            const streamKey = getStreamKey(demuxerMapKey, originalIndex);
            const outputIndexVal = outputIndexMap.get(streamKey);
            if (outputIndexVal === undefined) continue;
            const demuxer = this.demuxerMap.get(demuxerMapKey);
            if (!demuxer) continue;
            const isPreprocessed = demuxerMapKey.includes(':preprocess:');
            const stream = demuxer.getStream(isPreprocessed ? 0 : originalIndex);
            if (!stream) continue;
            const timeBaseNum = stream.timeBase.num;
            const timeBaseDen = stream.timeBase.den;
            const delaySec = streamDelayMap.get(streamKey) ?? 0;
            writeContextMap.set(streamKey, {
                outputIndex: outputIndexVal,
                delaySec,
                timeBaseNum,
                timeBaseDen,
                // Pre-resolve the delay in stream time-base units. This is
                // loop-invariant, so computing it per packet allocated a BigInt
                // for every packet on delay-bearing streams.
                delayInStreamUnits: delaySec === 0
                    ? 0n
                    : BigInt(Math.round(delaySec / (timeBaseNum / timeBaseDen))),
            });
        }

        // Filter out inactive demuxers
        const demuxerEntries = [...this.demuxerMap.entries()];
        const activeEntries = demuxerEntries.filter(([k]) => activeDemuxerKeys.has(k));

        // Mark streams as discarded so av_read_frame skips them entirely.
        // Two categories of streams in a file demuxer are pure waste to read:
        //   1. Preprocessed source streams — their output comes from the pipe
        //      demuxers (e.g. FLAC/TrueHD → opusenc), so reading them from the
        //      file demuxer is wasted work.
        //   2. Streams that will not be muxed at all (not selected for output).
        // A preprocessed stream's demuxerMapKey is `${filePath}:preprocess:<idx>`.
        const discardedSourceIndices = new Map<string, Set<number>>();
        for (const { demuxerMapKey, originalIndex } of [...videoStreams, ...audioStreams, ...subtitleStreams, ...attachmentStreams]) {
            if (!demuxerMapKey.includes(':preprocess:')) continue;
            const sourcePath = demuxerMapKey.split(':preprocess:')[0]!;
            let set = discardedSourceIndices.get(sourcePath);
            if (!set) {
                set = new Set();
                discardedSourceIndices.set(sourcePath, set);
            }
            set.add(originalIndex);
        }
        // Build the set of stream indices that are actually muxed (non-preprocessed)
        // per file demuxer, so we can discard everything else.
        const muxedSourceIndices = new Map<string, Set<number>>();
        for (const { demuxerMapKey, originalIndex } of [...videoStreams, ...audioStreams, ...subtitleStreams, ...attachmentStreams]) {
            if (demuxerMapKey.includes(':preprocess:')) continue;
            let set = muxedSourceIndices.get(demuxerMapKey);
            if (!set) {
                set = new Set();
                muxedSourceIndices.set(demuxerMapKey, set);
            }
            set.add(originalIndex);
        }
        for (const [sourcePath, indices] of discardedSourceIndices) {
            const demuxer = this.demuxerMap.get(sourcePath);
            if (!demuxer) continue;
            for (const idx of indices) {
                const stream = demuxer.getStream(idx);
                if (stream) stream.discard = AVDISCARD_ALL;
            }
        }
        // Discard any stream in a file demuxer that is not muxed.
        for (const [sourcePath, muxedIndices] of muxedSourceIndices) {
            const demuxer = this.demuxerMap.get(sourcePath);
            if (!demuxer) continue;
            for (const stream of demuxer.streams) {
                if (!muxedIndices.has(stream.index)) {
                    stream.discard = AVDISCARD_ALL;
                }
            }
        }

        const demuxerToKeys = new Map<Demuxer, string[]>();
        for (const [key, demuxer] of activeEntries) {
            const list = demuxerToKeys.get(demuxer) ?? [];
            list.push(key);
            demuxerToKeys.set(demuxer, list);
        }

        const readers: { reader: DemuxPacketReader; buckets: SyncPacketBucket[] }[] = [];

        for (const [demuxer, keys] of demuxerToKeys) {
            const isPreprocessedDemuxer = keys.some(k => k.includes(':preprocess:'));
            if (!isPreprocessedDemuxer) {
                demuxer.seekSync(0);
            }

            const buckets = keys.map(k => new SyncPacketBucket(k, writeContextMap));
            const reader = new DemuxPacketReader(demuxer, isPreprocessedDemuxer);
            readers.push({ reader, buckets });
        }

        // Yield to event loop so background encoding tasks can produce data
        await new Promise<void>(resolve => setImmediate(resolve));

        // Build progress tracker
        const episodeLabel = `S${this.episode.series.season.number.toString().padStart(2, '0')}E${this.episode.series.episode.number.toString().padStart(2, '0')}`;
        const tracker = new MuxProgressTracker(
            episodeLabel,
            writeContextMap,
            streamCodecTypes,
            sourceNames,
        );

        // Set stream durations from demuxer for progress %
        for (const [streamKey, ctx] of writeContextMap) {
            const sourceKey = resolveSourceKey(streamKey);
            const demuxer = this.demuxerMap.get(sourceKey);
            if (!demuxer) continue;

            const fmtDuration = demuxer.getFormatContext()?.duration;
            if (fmtDuration && fmtDuration > 0n) {
                tracker.setDurationUs(streamKey, Number(fmtDuration));
                continue;
            }

            const isPreprocessed = streamKey.includes(':preprocess:');
            const streamIndex = isPreprocessed ? 0 : parseInt(streamKey.split(':').pop() ?? '0', 10);
            const stream = demuxer.getStream(streamIndex);
            if (stream?.duration && stream.duration > 0n) {
                const us = Number(stream.duration) * ctx.timeBaseNum / ctx.timeBaseDen * 1_000_000;
                tracker.setDurationUs(streamKey, us);
            }
        }

        const PREFETCH_TARGET = 128;
        const PREFETCH_LOW_WATER = 16;
        const YIELD_INTERVAL = 500;
        const heap = new MinHeap<HeapEntry>((a, b) => a.sortDtsUs - b.sortDtsUs);

        const bucketToReader = new Map<SyncPacketBucket, { reader: DemuxPacketReader; buckets: SyncPacketBucket[] }>();
        for (const entry of readers) {
            for (const b of entry.buckets) {
                bucketToReader.set(b, { reader: entry.reader, buckets: entry.buckets });
            }
        }

        for (const { reader, buckets } of readers) {
            await reader.fillBuckets(buckets, 1);
            for (const b of buckets) {
                const entry = b.pull();
                if (entry) heap.push(entry);
            }
        }

        const refillBucketsForReader = async (targetBucket: SyncPacketBucket): Promise<void> => {
            if (targetBucket.exhausted) return;
            const owningEntry = bucketToReader.get(targetBucket);
            if (!owningEntry) return;
            let needsRefill = false;
            for (const b of owningEntry.buckets) {
                if (!b.exhausted && b.size < PREFETCH_LOW_WATER) { needsRefill = true; break; }
            }
            if (needsRefill) await owningEntry.reader.fillBuckets(owningEntry.buckets, PREFETCH_TARGET);
            const next = targetBucket.pull();
            if (next) {
                heap.push(next);
            } else {
                if (owningEntry.reader.exhausted) targetBucket.exhausted = true;
            }
        };

        let packetsSinceYield = 0;

        // Setup cancellation
        this.abortController = new AbortController();
        const cancelSignal = this.abortController.signal;

        // Progress emission timer
        const progressInterval = setInterval(() => {
            const snap = tracker.snapshot();
            this.emit('mux:progress', snap);
        }, 250);

        let cancelled = false;

        try {
            while (heap.size > 0) {
                if (cancelSignal.aborted) {
                    while (heap.size > 0) {
                        const entry = heap.pop()!;
                        entry.packet.free();
                    }
                    const reason = cancelSignal.reason;
                    const reasonStr = typeof reason === 'string' ? reason : 'cancelled';
                    cancelled = true;
                    tracker.setError(reasonStr);
                    this.emit('mux:error', tracker.snapshot());
                    output.closeSync();
                    this.removeOutputFile(this.outputPath(fileName));
                    log.info('mux cancelled:', { reason: reasonStr });
                    return undefined;
                }

                const entry = heap.pop()!;
                const { packet, bucket } = entry;
                const { demuxerMapKey } = bucket;

                const writeKey = buildWriteKey(demuxerMapKey, packet.streamIndex);
                const ctx = writeContextMap.get(writeKey);

                if (!ctx) {
                    packet.free();
                    await refillBucketsForReader(bucket);
                    continue;
                }

                if (ctx.delayInStreamUnits !== 0n) {
                    const delayInStreamUnits = ctx.delayInStreamUnits;
                    if (packet.dts !== AV_NOPTS_VALUE) packet.dts = packet.dts + delayInStreamUnits;
                    if (packet.pts !== AV_NOPTS_VALUE) packet.pts = packet.pts + delayInStreamUnits;
                }

                const keepNegativePackets = nodeAVOptions?.keepNegativePackets ?? false;
                if (!keepNegativePackets && packet.pts !== AV_NOPTS_VALUE && (packet.pts + packet.duration) < 0n) {
                    packet.free();
                    await refillBucketsForReader(bucket);
                    continue;
                }

                const clipTimestamps = nodeAVOptions?.clipTimestamps ?? false;
                if (clipTimestamps) {
                    if (packet.dts !== AV_NOPTS_VALUE && packet.dts < 0n) packet.dts = 0n;
                    if (packet.pts !== AV_NOPTS_VALUE && packet.pts < 0n) packet.pts = 0n;
                }

                // Record before freeing: recordPacket needs packet.dts/pts.
                tracker.recordPacket(writeKey, packet);
                try {
                    output.writePacketSync(packet, ctx.outputIndex);
                } finally {
                    packet.free();
                }
                packetsSinceYield++;

                await refillBucketsForReader(bucket);

                if (packetsSinceYield >= YIELD_INTERVAL) {
                    packetsSinceYield = 0;
                    await new Promise<void>(resolve => setImmediate(resolve));
                }
            }

            tracker.setComplete();
            this.emit('mux:complete', tracker.snapshot());
            log.info('mux completed:', { fileName });
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            tracker.setError(errMsg);
            this.emit('mux:error', tracker.snapshot());
            output.closeSync();
            this.removeOutputFile(this.outputPath(fileName));
            log.error('mux error:', { error: errMsg });
            throw err;
        } finally {
            clearInterval(progressInterval);
            this.abortController = undefined;
            log.debug('mux cleanup: closing readers');
            for (const { reader } of readers) await reader.close();
        }

        if (!cancelled) {
            for (const [, ctx] of writeContextMap) {
                output.writePacketSync(null, ctx.outputIndex);
            }

            output.closeSync();
            return fileName;
        }

        return undefined;
    }

    // #endregion Mux
}

export class EpisodeMuxerError extends Error {
    public readonly sourcePath: string;
    public readonly cause?: Error;

    constructor(message: string, sourcePath: string, options?: { cause?: Error }) {
        super(message);
        this.name = 'EpisodeMuxerError';
        this.sourcePath = sourcePath;
        this.cause = options?.cause;
        if (Error.captureStackTrace) Error.captureStackTrace(this, EpisodeMuxerError);
    }
}
