import { type AVCodecID } from 'node-av';
import {
    type AudioStreamMatch,
    type Multiplexer,
    type VideoStreamMatch,
    type AudioModify,
    type AudioPreprocess,
    type Episode,
    type StreamMatch,
    type SubtitleModify,
    type VideoModify,
    type VideoPreprocess,
} from './episode/types.js';
import { type Selector } from './selector/types.js';

export interface EpisodeMatch {
    /** Regex pattern as a plain string (not a RegExp object, for JSON compatibility). */
    regex: string;
    /** Optional flags for the regex pattern (e.g. "i", "g", "gi"). */
    regexFlags?: string;
    episodeIndex: number;
    seasonIndex?: number;
}

export interface MuxerOptions {
    // Overwrite existing files
    overwrite?: boolean;
    // Modify tags for the output file
    modifyTags?: Record<string, string | undefined>;
}

export interface ProcessingOptions {
    series: {
        name: string;
        season?: {
            number: number;
            name?: string;
        };
        seasonNames: Record<number, string>,
        episodeNames: Record<number, string[]>,
    }
    rename?: Episode['file']['rename'];
    method: Multiplexer;
    muxOptions?: MuxerOptions;
}

export interface Source {
    directory: string;
    // fileExtension: '.mkv' | '.mka' | '.mks' | '.mp4' | '.flac' | '.ass' | '.ttf' | `.${string}`;
    match?: EpisodeMatch;
    inheritFileName: boolean;
    /** Per-file metadata enabled state keyed by filename. */
    perFileMetadata?: Record<string, boolean>;
    /** Per-file chapter enabled state keyed by filename. */
    perFileChapters?: Record<string, boolean>;
    /** Per-file chapter delay in milliseconds keyed by filename. */
    perFileChapterDelay?: Record<string, number>;
    /** Per-file exclusion state keyed by filename. Excluded files are skipped during muxing. */
    perFileExcluded?: Record<string, boolean>;
    /** Per-file excluded track indices keyed by filename. Excluded tracks are skipped during muxing. */
    excludedTracks?: Record<string, number[]>;
    /** Per-file season number override keyed by filename. Overrides the regex-extracted season. */
    perFileSeasonOverride?: Record<string, number>;
    /** Per-file episode number override keyed by filename. Overrides the regex-extracted episode (applied after episodeOffset). */
    perFileEpisodeOverride?: Record<string, number>;
    /** Per-track inline modifiers keyed by filename → track-index → modify fields.
     *  These are merged on top of the stream-match item's modify block (per-track wins).
     *  Only applies to video, audio, and subtitle streams (not attachments). */
    perTrackModifiers?: Record<string, Record<number, {
        title?: string;
        language?: string;
        delay?: number;
        disposition?: Record<string, boolean>;
        tags?: Record<string, string>;
    }>>;
    // Offset the detected episode number
    episodeOffset?: number;
    // Override the detected season number
    season?: number;
    video?: [{
        name?: string;
        match?: VideoStreamMatch;
        modify?: VideoModify;
        preprocess?: VideoPreprocess;
    }];
    audio?: [{
        name?: string;
        match?: AudioStreamMatch;
        modify?: AudioModify;
        preprocess?: AudioPreprocess;
    }];
    subtitle?: [{
        name?: string;
        match?: StreamMatch;
        modify?: SubtitleModify;
    }];
    attachment?: [{
        name?: string;
        match?: {
            codec?: Selector<AVCodecID>;
            fileName?: Selector<string>;
            mimeType?: Selector<string>;
        };
    }];
}
