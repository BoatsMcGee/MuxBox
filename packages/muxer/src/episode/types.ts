import { type AVCodecID, type AVDisposition } from 'node-av';
import { type Selector } from '../selector/types.js';
import { type TemplateTags } from '../@utils/filename-template.js';
import { type DispositionState } from '../ffmpeg/dispositions.js';
import type { TrackComparison, StreamInfo } from './progress.js';

export type { TrackComparison, StreamInfo };

/** Per-field prefix/suffix/always-add/padding configuration for rename template fields. */
export interface FieldConfig {
    prefix: string;
    suffix: string;
    alwaysAdd: boolean;
    /** Minimum zero-padding for numeric fields (season/episode numbers). Default 2. */
    padding?: number;
}

export interface VideoModify {
    language?: string;
    title?: string;
    disposition?: DispositionState;
    tags?: {
        [key: string]: string | undefined;
    };
}

export interface VideoPreprocess {
    grav1synth?: {
        iso: number;
        chroma?: boolean;
        width?: number;
        height?: number;
        outputTable?: string;
        cY?: string;
        cCb?: string;
        cCr?: string;
    };
}

export interface AudioModify {
    language?: string;
    title?: string;
    disposition?: DispositionState;
    tags?: {
        [key: string]: string;
    };
    // convert?: {
    //     opus: OpusConversionOptions;
    // };
    /** Delay in milliseconds */
    delay?: number;
}

export interface AudioPreprocess {
  opusenc?: {
      bitrate?: number;
      downmix?: 'stereo' | 'mono';
      computationalComplexity?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
      framesize?: 2.5 | 5 | 10 | 20 | 40 | 60;
      volumeWorkaround?: boolean;
      normalize?: boolean;
  };
//   ac3?: {
//       bitrate?: number;
//       channels?: number;
//   };
//   flac?: {
//       bitrate?: number;
//       channels?: number;
//   };
}

export interface SubtitleModify {
    language?: string;
    title?: string;
    disposition?: DispositionState;
    tags?: {
        [key: string]: string;
    };
    /** Delay in milliseconds */
    delay?: number;
    /**
     * Force zlib compression on the track. Defaults to true when omitted.
     * Only applied to text-based subtitle codecs; bitmap subs are unaffected.
     */
    compress?: boolean;
}

export interface StreamMatch {
    index?: Selector<number>;
    codec?: Selector<AVCodecID>;
    title?: Selector<string>;
    language?: Selector<string>;
    disposition?: Partial<Record<AVDisposition, Selector<boolean>>>;
    size?: Selector<number>;
    duration?: Selector<number>;
    tags?: Record<string, Selector<string>>;
}

export interface VideoStreamMatch extends StreamMatch {
    width?: Selector<number>;
    height?: Selector<number>;
    bitrate?: Selector<number>;
}

export interface AudioStreamMatch extends StreamMatch {
    channels?: Selector<number>;
    bitrate?: Selector<number>;
}

export interface NativeMultiplexer {
    // Discard packets that end before 0
    keepNegativePackets?: boolean;
    // Clip negative timestamps to 0
    clipTimestamps?: boolean;
}

export interface FFmpegMultiplexer {
    // temporary directory containing preprocessed streams that will be muxed with FFmpeg
    tempDir: string;
}

export type Multiplexer = NativeMultiplexer | FFmpegMultiplexer;

export interface Episode {
    file: {
        directory: string;
        name: string;
        overwrite?: boolean;
        rename?: {
            template: string;
            tags?: TemplateTags;
            /** Per-field prefix/suffix/always-add/padding configuration keyed by template tag (e.g. "{{SEASON_NUMBER}}"). */
            fieldConfig?: Record<string, FieldConfig>;
        };
        fieldConfig?: FieldConfig;
    };
    series: {
        name: string;
        season: {
            number: number;
            name?: string;
        };
        episode: {
            number: number;
            name?: string;
        };
    };
    modifyTags?: Record<string, string>;
    method: Multiplexer;
    /** Optional explicit chapters source (used by multimux-core post-processing) */
    chaptersSource?: {
        directory: string;
        fileName: string;
        /** Delay in milliseconds */
        delay?: number;
    };
    sources: {
        file: {
            directory: string;
            name: string;
        };
        chapters?: {
            /** Delay in milliseconds to apply to chapter timestamps */
            delay?: number;
        };
        /** Whether this source should be used for inheriting metadata into the output file */
        inheritMetadata?: boolean;
        /** Per-track inline modifiers keyed by track index.
         *  Merged on top of the stream-match item's modify block (per-track wins). */
        perTrackModifiers?: Record<number, {
            title?: string;
            language?: string;
            delay?: number;
            disposition?: Record<string, boolean>;
            tags?: Record<string, string>;
            /** Overrides `modify.compress` for this track. Undefined means "inherit". */
            compress?: boolean;
        }>;
        /** Excluded track indices (stream indices) that are skipped during muxing. */
        excludedTracks?: number[];
        video?: {
            name?: string;
            match?: VideoStreamMatch;
            modify?: VideoModify;
            preprocess?: VideoPreprocess;
        }[];
        audio?: {
            name?: string;
            match?: AudioStreamMatch;
            modify?: AudioModify;
            preprocess?: AudioPreprocess;
        }[];
        subtitle?: {
            name?: string;
            match?: StreamMatch;
            modify?: SubtitleModify;
        }[];
        attachment?: {
            name?: string;
            match?: {
                codec?: Selector<AVCodecID>;
                fileName?: Selector<string>;
                mimeType?: Selector<string>;
            };
        }[];
    }[];
}

// #region EpisodeMuxer Event Interfaces

export interface PreprocessingStartEvent {
    totalStreams: number;
}

export interface PreprocessingProgressEvent {
    streamIndex: number;
    sourcePath: string;
    streamProgress: number;
    overallProgress: number;
}

export interface PreprocessingCompleteEvent {
    totalStreams: number;
}

export interface MuxingStartEvent {
    fileName: string;
}

export interface StreamInfoEvent {
    type: 'video' | 'audio' | 'subtitle';
    outputIndex: number;
    changes: string;
}

export interface PacketCollectionStartEvent {
    sourcePath: string;
}

export interface PacketCollectionSkipEvent {
    sourcePath: string;
}

export interface PacketCollectionCompleteEvent {
    totalPackets: number;
    durationMs: number;
}

export interface PacketWritingProgressEvent {
    packetsWritten: number;
    totalPackets: number;
    percent: number;
    elapsedMs: number;
    eta: string;
    packetsPerSecond: number;
}

export interface PacketWritingCompleteEvent {
    totalPackets: number;
    durationMs: number;
    averagePacketsPerSecond: number;
}

export interface StreamPacketCountEvent {
    type: 'video' | 'audio' | 'subtitle' | 'attachment';
    outputIndex: number | undefined;
    originalIndex: number;
    packetCount: number;
}

export interface SkippedEvent {
    reason: string;
    fileName?: string;
}

export interface MkvmergeStartEvent {
    filePath: string;
}

export interface MkvmergeCompleteEvent {
    fileName: string;
}

export interface FFmpegStartEvent {
    command: string;
    args: string[];
}

// #endregion EpisodeMuxer Event Interfaces

// ─── MuxerModel ──────────────────────────────────────────────

/**
 * Result of the simulated muxer model — pure data, no native resources.
 * Returned by `buildEpisodeModel()` in the simulator module.
 */
export interface MuxerModel {
    comparisons: TrackComparison[];
    streamInfos: StreamInfo[];
}
