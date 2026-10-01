export type { EpisodeMatch, MuxerOptions as MuxOptions, Source } from './types.js';
export type {
    VideoModify,
    VideoPreprocess,
    AudioModify,
    AudioPreprocess,
    SubtitleModify,
    StreamMatch,
    VideoStreamMatch,
    AudioStreamMatch,
    Multiplexer,
    NativeMultiplexer,
    FFmpegMultiplexer,
    Episode,
    MuxerModel,
    FieldConfig,
} from './episode/types.js';
export type { PerTrackModifier } from './selector/index.js';
export { EpisodeMuxer } from './episode/muxer.js';
export type { MuxSnapshot, TrackComparison, StreamInfo, SerializedMuxSnapshot } from './episode/progress.js';
export { serializeSnapshot } from './episode/progress.js';
export { getCodecName } from './ffmpeg/codec-names.js';
export { ALL_DISPOSITIONS } from './sorter/index.js';
export { getDispositionName } from './ffmpeg/dispositions.js';

// Coordinator: per-episode worker-thread muxing
export { MuxCoordinator } from './coordinator/coordinator.js';
export type { EpisodeJob, JobState, JobStatus } from './coordinator/coordinator.js';

// Shared FFmpeg concurrency semaphore used by both @app/muxer and @app/preload
export { acquireFfmpegSemaphore, releaseFfmpegSemaphore } from './ffmpeg/concurrency.js';

// Simulation (used by preload to build the model)
export { buildEpisodeModel } from './episode/simulator.js';

// Codec info (shared constants and entry list)
export { getCodecConstants, getCodecEntryList } from './codec-info.js';
export type { CodecConstants, CodecEntry } from './codec-info.js';

// Probing (demux streams with cache)
export { demuxStreams, clearProbeCache } from './probe.js';

// Encoders (opusenc preprocessing)
export { pipeAudioToOpusenc, buildFfmpegDecodeArgs, type OpusencOptions } from './encoders/index.js';
