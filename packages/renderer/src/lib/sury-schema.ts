import * as S from 'sury';

// ─── Selector Schema (recursive) ────────────────────────────
// Backend: Selector<T> = { equal: T } | { not: Selector<T> } | { allOf: Selector<T>[] }
//                   | { anyOf: Selector<T>[] } | { oneOf: Selector<T>[] }
//                   | { greaterThan: number } | { lessThan: number }
//                   | { pattern: string } | { contains: string }
//                   | { startsWith: string } | { endsWith: string }
// T can be boolean, number, or string (AVCodecID/AVDisposition are numeric)

const selectorSchema: S.Schema<unknown, unknown> = S.recursive<unknown, unknown>('Selector', (self) =>
    S.union([
        // equal can be boolean, number, or string
        S.object((ctx) => ({ equal: ctx.field('equal', S.union([S.boolean, S.number, S.string])) })),
        S.object((ctx) => ({ not: ctx.field('not', self) })),
        S.object((ctx) => ({ allOf: ctx.field('allOf', S.array(self)) })),
        S.object((ctx) => ({ anyOf: ctx.field('anyOf', S.array(self)) })),
        S.object((ctx) => ({ oneOf: ctx.field('oneOf', S.array(self)) })),
        S.object((ctx) => ({ greaterThan: ctx.field('greaterThan', S.number) })),
        S.object((ctx) => ({ lessThan: ctx.field('lessThan', S.number) })),
        S.object((ctx) => ({ pattern: ctx.field('pattern', S.string) })),
        S.object((ctx) => ({ contains: ctx.field('contains', S.string) })),
        S.object((ctx) => ({ startsWith: ctx.field('startsWith', S.string) })),
        S.object((ctx) => ({ endsWith: ctx.field('endsWith', S.string) })),
    ]),
);

// ─── Codec Selector Schema (numeric-only) ───────────────────────
// AVCodecID is numeric, so codec selector should only accept numeric values
// for 'equal' and numeric comparisons (greaterThan, lessThan)

const codecSelectorSchema: S.Schema<unknown, unknown> = S.recursive<unknown, unknown>(
    'CodecSelector',
    (self) =>
        S.union([
            // equal must be a number (AVCodecID is numeric)
            S.object((ctx) => ({ equal: ctx.field('equal', S.number) })),
            S.object((ctx) => ({ not: ctx.field('not', self) })),
            S.object((ctx) => ({ allOf: ctx.field('allOf', S.array(self)) })),
            S.object((ctx) => ({ anyOf: ctx.field('anyOf', S.array(self)) })),
            S.object((ctx) => ({ oneOf: ctx.field('oneOf', S.array(self)) })),
            S.object((ctx) => ({ greaterThan: ctx.field('greaterThan', S.number) })),
            S.object((ctx) => ({ lessThan: ctx.field('lessThan', S.number) })),
        ]),
);

// ─── Stream Match Schemas ───────────────────────────────────
// Backend types (from packages/muxer/src/episode/types.ts):
//
// export interface StreamMatch {
//     index?: Selector<number>;
//     codec?: Selector<AVCodecID>;  // AVCodecID is numeric
//     title?: Selector<string>;
//     language?: Selector<string>;
//     disposition?: Partial<Record<AVDisposition, Selector<boolean>>>;
//     size?: Selector<number>;
//     duration?: Selector<number>;
//     tags?: Record<string, Selector<string>>;
// }
//
// export interface VideoStreamMatch extends StreamMatch {
//     width?: Selector<number>;
//     height?: Selector<number>;
//     bitrate?: Selector<number>;
// }
//
// export interface AudioStreamMatch extends StreamMatch {
//     channels?: Selector<number>;
//     bitrate?: Selector<number>;
// }
//
// DispositionState = Partial<Record<AVDisposition, boolean>>
// AVDisposition is a numeric enum (1, 2, 4, 8, 16, 32, 64, 128, 256, ...)

// Disposition schema: Partial<Record<AVDisposition, Selector<boolean>>>
// Each key is a numeric disposition flag (as string), value is a Selector<boolean>
const dispositionSchema = S.record(selectorSchema);

const streamMatchSchema = S.object((ctx) => ({
    index: ctx.field('index', S.optional(selectorSchema)),
    codec: ctx.field('codec', S.optional(codecSelectorSchema)),
    title: ctx.field('title', S.optional(selectorSchema)),
    language: ctx.field('language', S.optional(selectorSchema)),
    disposition: ctx.field('disposition', S.optional(dispositionSchema)),
    size: ctx.field('size', S.optional(selectorSchema)),
    duration: ctx.field('duration', S.optional(selectorSchema)),
    tags: ctx.field('tags', S.optional(S.record(selectorSchema))),
}));

const videoStreamMatchSchema = S.object((ctx) => ({
    index: ctx.field('index', S.optional(selectorSchema)),
    codec: ctx.field('codec', S.optional(codecSelectorSchema)),
    title: ctx.field('title', S.optional(selectorSchema)),
    language: ctx.field('language', S.optional(selectorSchema)),
    disposition: ctx.field('disposition', S.optional(dispositionSchema)),
    size: ctx.field('size', S.optional(selectorSchema)),
    duration: ctx.field('duration', S.optional(selectorSchema)),
    tags: ctx.field('tags', S.optional(S.record(selectorSchema))),
    width: ctx.field('width', S.optional(selectorSchema)),
    height: ctx.field('height', S.optional(selectorSchema)),
    bitrate: ctx.field('bitrate', S.optional(selectorSchema)),
}));

const audioStreamMatchSchema = S.object((ctx) => ({
    index: ctx.field('index', S.optional(selectorSchema)),
    codec: ctx.field('codec', S.optional(codecSelectorSchema)),
    title: ctx.field('title', S.optional(selectorSchema)),
    language: ctx.field('language', S.optional(selectorSchema)),
    disposition: ctx.field('disposition', S.optional(dispositionSchema)),
    size: ctx.field('size', S.optional(selectorSchema)),
    duration: ctx.field('duration', S.optional(selectorSchema)),
    tags: ctx.field('tags', S.optional(S.record(selectorSchema))),
    channels: ctx.field('channels', S.optional(selectorSchema)),
    bitrate: ctx.field('bitrate', S.optional(selectorSchema)),
}));

// ─── Stream Item Schemas ────────────────────────────────────
// Backend (from Episode.sources[].video/audio/subtitle/attachment):
//
// video?: { match?: VideoStreamMatch; modify?: VideoModify; preprocess?: VideoPreprocess; }[]
// audio?: { match?: AudioStreamMatch; modify?: AudioModify; preprocess?: AudioPreprocess; }[]
// subtitle?: { match?: StreamMatch; modify?: SubtitleModify; }[]
// attachment?: { match?: { codec?: Selector<AVCodecID>; fileName?: Selector<string>; mimeType?: Selector<string>; }; }[]

// VideoModify: { language?: string; title?: string; disposition?: DispositionState; tags?: Record<string, string | undefined>; }
// AudioModify: { language?: string; title?: string; disposition?: DispositionState; tags?: Record<string, string>; delay?: number; // milliseconds }
// SubtitleModify: { language?: string; title?: string; disposition?: DispositionState; tags?: Record<string, string>; delay?: number; // milliseconds }
// VideoPreprocess: { grav1synth?: { iso: number; chroma?: boolean; width?: number; height?: number; outputTable?: string; cY?: string; cCb?: string; cCr?: string; }; }
// AudioPreprocess: { opusenc?: { bitrate?: number; downmix?: 'stereo'|'mono'; computationalComplexity?: 0-10; framesize?: 2.5|5|10|20|40|60; volumeWorkaround?: boolean; normalize?: boolean; }; }

const videoModifySchema = S.object((ctx) => ({
    language: ctx.field('language', S.optional(S.string)),
    title: ctx.field('title', S.optional(S.string)),
    disposition: ctx.field('disposition', S.optional(dispositionSchema)),
    tags: ctx.field('tags', S.optional(S.record(S.string))),
}));

const audioModifySchema = S.object((ctx) => ({
    language: ctx.field('language', S.optional(S.string)),
    title: ctx.field('title', S.optional(S.string)),
    disposition: ctx.field('disposition', S.optional(dispositionSchema)),
    tags: ctx.field('tags', S.optional(S.record(S.string))),
    delay: ctx.field('delay', S.optional(S.number)),
}));

const subtitleModifySchema = S.object((ctx) => ({
    language: ctx.field('language', S.optional(S.string)),
    title: ctx.field('title', S.optional(S.string)),
    disposition: ctx.field('disposition', S.optional(dispositionSchema)),
    tags: ctx.field('tags', S.optional(S.record(S.string))),
    delay: ctx.field('delay', S.optional(S.number)),
}));

const videoPreprocessSchema = S.object((ctx) => ({
    grav1synth: ctx.field('grav1synth', S.optional(S.object((inner) => ({
        iso: inner.field('iso', S.number),
        chroma: inner.field('chroma', S.optional(S.boolean)),
        width: inner.field('width', S.optional(S.number)),
        height: inner.field('height', S.optional(S.number)),
        outputTable: inner.field('outputTable', S.optional(S.string)),
        cY: inner.field('cY', S.optional(S.string)),
        cCb: inner.field('cCb', S.optional(S.string)),
        cCr: inner.field('cCr', S.optional(S.string)),
    })))),
}));

const audioPreprocessSchema = S.object((ctx) => ({
    opusenc: ctx.field('opusenc', S.optional(S.object((inner) => ({
        bitrate: inner.field('bitrate', S.optional(S.number)),
        downmix: inner.field('downmix', S.string),
        computationalComplexity: inner.field('computationalComplexity', S.optional(S.number)),
        framesize: inner.field('framesize', S.union([S.number, S.string])),
        volumeWorkaround: inner.field('volumeWorkaround', S.optional(S.boolean)),
        normalize: inner.field('normalize', S.optional(S.boolean)),
    })))),
}));

const videoStreamItemSchema = S.object((ctx) => ({
    match: ctx.field('match', S.optional(videoStreamMatchSchema)),
    modify: ctx.field('modify', S.optional(videoModifySchema)),
    preprocess: ctx.field('preprocess', S.optional(videoPreprocessSchema)),
}));

const audioStreamItemSchema = S.object((ctx) => ({
    match: ctx.field('match', S.optional(audioStreamMatchSchema)),
    modify: ctx.field('modify', S.optional(audioModifySchema)),
    preprocess: ctx.field('preprocess', S.optional(audioPreprocessSchema)),
}));

const subtitleStreamItemSchema = S.object((ctx) => ({
    match: ctx.field('match', S.optional(streamMatchSchema)),
    modify: ctx.field('modify', S.optional(subtitleModifySchema)),
}));

const attachmentItemSchema = S.object((ctx) => ({
    match: ctx.field('match', S.optional(S.object((inner) => ({
        codec: inner.field('codec', S.optional(codecSelectorSchema)),
        fileName: inner.field('fileName', S.optional(selectorSchema)),
        mimeType: inner.field('mimeType', S.optional(selectorSchema)),
    })))),
}));

// Per-track inline modifiers (Source.perTrackModifiers):
// Record<filename, Record<trackIndex, { title?, language?, delay?, disposition?, tags? }>>
const perTrackModifierSchema = S.object((ctx) => ({
    title: ctx.field('title', S.optional(S.string)),
    language: ctx.field('language', S.optional(S.string)),
    delay: ctx.field('delay', S.optional(S.number)),
    disposition: ctx.field('disposition', S.optional(S.record(S.boolean))),
    tags: ctx.field('tags', S.optional(S.record(S.string))),
}));

// ─── Episode Match Schema ──────────────────────────────────────
// Backend:
// export interface EpisodeMatch {
//     regex: string;       // plain string (not RegExp), JSON-compatible
//     regexFlags?: string; // optional flags like "i", "g"
//     episodeIndex: number;
//     seasonIndex?: number;
// }
// JSON serialization: regex is stored as a plain string.
// Legacy projects may still have "/pattern/flags" format (RegExp.toString()) —
// migration in projectFs.ts converts these to regex + regexFlags on load.

const episodeMatchSchema = S.object((ctx) => ({
    regex: ctx.field('regex', S.string),
    regexFlags: ctx.field('regexFlags', S.optional(S.string)),
    episodeIndex: ctx.field('episodeIndex', S.number),
    seasonIndex: ctx.field('seasonIndex', S.optional(S.number)),
}));

// ─── Source Schema ──────────────────────────────────────────
// Backend (Episode.sources[]):
//
// file: { directory: string; name: string; }
// video?: { match?: VideoStreamMatch; modify?: VideoModify; preprocess?: VideoPreprocess; }[]
// audio?: { match?: AudioStreamMatch; modify?: AudioModify; preprocess?: AudioPreprocess; }[]
// subtitle?: { match?: StreamMatch; modify?: SubtitleModify; }[]
// attachment?: { match?: { codec?: Selector<AVCodecID>; fileName?: Selector<string>; mimeType?: Selector<string>; }; }[]
// Per-file maps (Source.perFile*): single source of truth, keyed by filename.

export const sourceSchema = S.object((ctx) => ({
    directory: ctx.field('directory', S.string),
    file: ctx.field('file', S.object((inner) => ({
        name: inner.field('name', S.string),
    }))),
    // match can be either a legacy RegExp string ("/pattern/flags") or an EpisodeMatch object
    match: ctx.field('match', S.optional(S.union([S.string, episodeMatchSchema]))),
    inheritFileName: ctx.fieldOr('inheritFileName', S.boolean, true),
    episodeOffset: ctx.field('episodeOffset', S.optional(S.number)),
    season: ctx.field('season', S.optional(S.number)),
    excludedTracks: ctx.field('excludedTracks', S.optional(S.record(S.array(S.number)))),
    perFileMetadata: ctx.field('perFileMetadata', S.optional(S.record(S.boolean))),
    perFileChapters: ctx.field('perFileChapters', S.optional(S.record(S.boolean))),
    perFileChapterDelay: ctx.field('perFileChapterDelay', S.optional(S.record(S.number))),
    perFileExcluded: ctx.field('perFileExcluded', S.optional(S.record(S.boolean))),
    perFileSeasonOverride: ctx.field('perFileSeasonOverride', S.optional(S.record(S.nullable(S.number)))),
    perFileEpisodeOverride: ctx.field('perFileEpisodeOverride', S.optional(S.record(S.nullable(S.number)))),
    perTrackModifiers: ctx.field('perTrackModifiers', S.optional(S.record(S.record(perTrackModifierSchema)))),
    video: ctx.fieldOr('video', S.array(videoStreamItemSchema), []),
    audio: ctx.fieldOr('audio', S.array(audioStreamItemSchema), []),
    subtitle: ctx.fieldOr('subtitle', S.array(subtitleStreamItemSchema), []),
    attachment: ctx.fieldOr('attachment', S.array(attachmentItemSchema), []),
}));

const stringRecordSchema = S.record(S.string);

export const muxOptionsSchema = S.object((ctx) => ({
    overwrite: ctx.fieldOr('overwrite', S.boolean, false),
    modifyTags: ctx.field('modifyTags', S.optional(stringRecordSchema)),
}));

// ─── Project Schema ─────────────────────────────────────────
// Backend (Episode):
//
// export interface Episode {
//     file: { directory: string; name: string; overwrite?: boolean; rename?: { template: string; tags?: TemplateTags; }; };
//     series: { name: string; season: { number: number; name?: string; }; episode: { number: number; name?: string; }; };
//     method: Multiplexer;
//     chaptersSource?: { directory: string; fileName: string; delay?: number; };
//     sources: { ... }[];
// }
//
// ProjectSchema in sury adds: id, name, seriesName, specialsName, tmdbSeriesId, tmdbSeriesName, createdAt, updatedAt

export const projectSchema = S.object((ctx) => ({
    id: ctx.field('id', S.string),
    name: ctx.field('name', S.string),
    seriesName: ctx.fieldOr('seriesName', S.string, ''),
    specialsName: ctx.fieldOr('specialsName', S.string, 'OVA'),
    rename: ctx.field('rename', S.object((inner) => ({
        template: inner.fieldOr('template', S.string, '{{SERIES_NAME}} - {{SEASON_NUMBER}}{{EPISODE_NUMBER}} - {{EPISODE_NAME}}'),
        tags: inner.field('tags', S.optional(stringRecordSchema)),
    }))),
    muxOptions: ctx.field('muxOptions', muxOptionsSchema),
    sources: ctx.fieldOr('sources', S.array(sourceSchema), []),
    tmdbSeriesId: ctx.field('tmdbSeriesId', S.optional(S.number)),
    tmdbSeriesName: ctx.field('tmdbSeriesName', S.optional(S.string)),
    createdAt: ctx.fieldOr('createdAt', S.number, Date.now()),
    updatedAt: ctx.fieldOr('updatedAt', S.number, Date.now()),
}));

// ─── JSON Schema Exports (for Monaco validation) ────────────

export const sourceJSONSchema = S.toJSONSchema(sourceSchema) as Record<string, unknown>;
export const projectJSONSchema = S.toJSONSchema(projectSchema) as Record<string, unknown>;
export const muxOptionsJSONSchema = S.toJSONSchema(muxOptionsSchema) as Record<string, unknown>;
export const videoMatchJSONSchema = S.toJSONSchema(videoStreamMatchSchema) as Record<string, unknown>;
export const audioMatchJSONSchema = S.toJSONSchema(audioStreamMatchSchema) as Record<string, unknown>;
export const subtitleMatchJSONSchema = S.toJSONSchema(streamMatchSchema) as Record<string, unknown>;
export const attachmentMatchJSONSchema = S.toJSONSchema(attachmentItemSchema) as Record<string, unknown>;
