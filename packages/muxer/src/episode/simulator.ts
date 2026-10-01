/**
 * Simulated MuxerModel builder.
 *
 * Given an Episode config and cached StreamInfo[] per source file, produces the
 * same TrackComparison[] and StreamInfo[] that a real EpisodeMuxer would, but
 * without opening any native Demuxer handles.
 *
 * The simulation uses the same shared functions as the real path:
 * - `evaluateStreamMatch()` from selector/index.ts
 * - `applyStreamModify()` from modifier/index.ts
 * - `mergeTrackModifier()` from selector/index.ts
 * - `simulatePreprocessEffect()` from stream-props.ts
 * - `simulateSortStreams()` (mirror of sortStreams from sorter/index.ts)
 *
 * This ensures zero divergence between what the UI shows and what muxing produces.
 */

import path from 'node:path';
import {
    type AVCodecID,
    type AVDisposition,
    AVMEDIA_TYPE_VIDEO,
    AVMEDIA_TYPE_AUDIO,
    AVMEDIA_TYPE_SUBTITLE,
    AVMEDIA_TYPE_ATTACHMENT,
} from 'node-av';
import {
    type Episode,
    type MuxerModel,
    type AudioPreprocess,
    type VideoPreprocess,
    type AudioModify,
    type SubtitleModify,
    type VideoModify,
} from './types.js';
import { type StreamInfo, type TrackComparison } from './progress.js';
import { type PerTrackModifier, evaluateStreamMatch, mergeTrackModifier } from '../selector/index.js';
import { applyStreamModify } from '../modifier/index.js';
import { extractInfoStreamProperties, simulatePreprocessEffect } from './stream-props.js';
import { getCodecName } from '../ffmpeg/codec-names.js';
import { getDispositionName } from '../ffmpeg/dispositions.js';

// ─── Types ───────────────────────────────────────────────────

interface SimulatedStream {
    demuxerMapKey: string;
    originalIndex: number;
    originalCodec: AVCodecID | undefined;
    originalMetadata: Record<string, string>;
    originalDispositions: number[];
    muxedCodecName: string;
    muxedCodecId: AVCodecID;
    muxedMetadata: Record<string, string>;
    muxedDispositions: number[];
    muxedFilename: string | undefined;
    muxedMimetype: string | undefined;
    /** Effective delay in ms after source modifications (rule modify + per-track). */
    muxedDelay?: number;
    modify: VideoModify | AudioModify | SubtitleModify | undefined;
    modifyType: 'video' | 'audio' | 'subtitle' | 'attachment';
}

// ─── Sorting (mirrors sorter/index.ts) ───────────────────────

const DISPOSITION_SORT_PRIORITY: Record<string, number> = {
    Forced: 0,
    Default: 1,
    None: 2,
    Dub: 3,
    'Hearing Impaired': 4,
    'Visual Impaired': 5,
    Captions: 6,
    Comment: 7,
    Rest: 8,
};

function getDispositionPriority(dispNames: string[]): number {
    if (dispNames.includes('Forced')) return DISPOSITION_SORT_PRIORITY['Forced'];
    if (dispNames.includes('Default')) return DISPOSITION_SORT_PRIORITY['Default'];
    if (dispNames.length === 0) return DISPOSITION_SORT_PRIORITY['None'];
    if (dispNames.includes('Dub')) return DISPOSITION_SORT_PRIORITY['Dub'];
    if (dispNames.includes('Hearing Impaired')) return DISPOSITION_SORT_PRIORITY['Hearing Impaired'];
    if (dispNames.includes('Visual Impaired')) return DISPOSITION_SORT_PRIORITY['Visual Impaired'];
    if (dispNames.includes('Captions')) return DISPOSITION_SORT_PRIORITY['Captions'];
    if (dispNames.includes('Comment')) return DISPOSITION_SORT_PRIORITY['Comment'];
    return DISPOSITION_SORT_PRIORITY['Rest'];
}

function getDispositionNames(dispositions: number[]): string[] {
    return dispositions
        .map(d => getDispositionName(d as AVDisposition))
        .filter((d): d is string => d !== undefined);
}

/**
 * Mirrors `sortStreams()` from sorter/index.ts.
 * Sorts by: Original-first, then disposition hierarchy, then language.
 */
function simulateSortStreams(streams: SimulatedStream[]): void {
    streams.sort((a, b) => {
        const aDispNames = getDispositionNames(a.muxedDispositions);
        const bDispNames = getDispositionNames(b.muxedDispositions);
        const aHasOriginal = aDispNames.includes('Original');
        const bHasOriginal = bDispNames.includes('Original');

        if (aHasOriginal && !bHasOriginal) return -1;
        if (!aHasOriginal && bHasOriginal) return 1;

        if (aHasOriginal && bHasOriginal) {
            return getDispositionPriority(aDispNames) - getDispositionPriority(bDispNames);
        }

        // Neither is Original: sort by language
        const aLang = a.muxedMetadata['language'] ?? '';
        const bLang = b.muxedMetadata['language'] ?? '';
        if (aLang < bLang) return -1;
        if (aLang > bLang) return 1;

        return getDispositionPriority(aDispNames) - getDispositionPriority(bDispNames);
    });
}

// ─── Simulated selection per source ─────────────────────────

interface SourceSelectors {
    video: { match?: Record<string, unknown>; modify?: VideoModify; preprocess?: VideoPreprocess }[];
    audio: { match?: Record<string, unknown>; modify?: AudioModify; preprocess?: AudioPreprocess }[];
    subtitle: { match?: Record<string, unknown>; modify?: SubtitleModify }[];
    attachment: { match?: Record<string, unknown> }[];
}

function runSimulatedSelection(
    filePath: string,
    streamInfos: StreamInfo[],
    selectors: SourceSelectors,
    perTrackModifiers?: Record<number, PerTrackModifier>,
    excludedTracks?: number[],
): SimulatedStream[] {
    const results: SimulatedStream[] = [];
    const excludedSet = excludedTracks && excludedTracks.length > 0 ? new Set(excludedTracks) : undefined;

    const processType = (
        type: 'video' | 'audio' | 'subtitle' | 'attachment',
        typeSelectors: { match?: Record<string, unknown>; modify?: unknown; preprocess?: unknown }[],
        mediaTypeCode: number,
    ): void => {
        const candidates = streamInfos.filter(s => s.codecType === mediaTypeCode && !excludedSet?.has(s.index));
        if (candidates.length === 0) return;

        const usedIndices = new Set<number>();

        if (typeSelectors.length === 0) {
            // No selectors → include all streams unchanged
            for (const info of candidates) {
                results.push(buildSimulatedStream(filePath, info, type, undefined, undefined));
                usedIndices.add(info.index);
            }
            return;
        }

        for (const sel of typeSelectors) {
            if (!sel.match) {
                // Selector without match → all remaining streams
                for (const info of candidates) {
                    if (usedIndices.has(info.index)) continue;
                    const mergedModify = mergeModifyWithPerTrack(sel.modify, info.index, perTrackModifiers);
                    results.push(buildSimulatedStream(filePath, info, type, mergedModify, sel.preprocess));
                    usedIndices.add(info.index);
                }
                continue;
            }

            for (const info of candidates) {
                if (usedIndices.has(info.index)) continue;
                if (evaluateStreamMatch(sel.match as Record<string, unknown>, extractInfoStreamProperties(info))) {
                    const mergedModify = mergeModifyWithPerTrack(sel.modify, info.index, perTrackModifiers);
                    results.push(buildSimulatedStream(filePath, info, type, mergedModify, sel.preprocess));
                    usedIndices.add(info.index);
                }
            }
        }
    };

    processType('video', selectors.video, AVMEDIA_TYPE_VIDEO);
    processType('audio', selectors.audio, AVMEDIA_TYPE_AUDIO);
    processType('subtitle', selectors.subtitle, AVMEDIA_TYPE_SUBTITLE);
    processType('attachment', selectors.attachment, AVMEDIA_TYPE_ATTACHMENT);

    return results;
}

function mergeModifyWithPerTrack(
    modify: unknown,
    streamIndex: number,
    perTrackModifiers?: Record<number, PerTrackModifier>,
): Record<string, unknown> | undefined {
    const trackMod = perTrackModifiers?.[streamIndex];
    if (!trackMod && !modify) return undefined;
    if (trackMod && modify) {
        return mergeTrackModifier(modify as Record<string, unknown>, trackMod);
    }
    if (trackMod) return trackMod as unknown as Record<string, unknown>;
    return modify as Record<string, unknown> | undefined;
}

function buildSimulatedStream(
    filePath: string,
    info: StreamInfo,
    type: 'video' | 'audio' | 'subtitle' | 'attachment',
    modify: Record<string, unknown> | undefined,
    preprocess: unknown,
): SimulatedStream {
    const originalMetadata = { ...info.metadata };
    const originalDispositions = [...(info.dispositions ?? [])];
    const originalCodec = info.codecId as AVCodecID;

    let muxedCodecId = info.codecId as AVCodecID;
    let muxedCodecName = info.codecName;
    let muxedMetadata = { ...info.metadata };
    let muxedDispositions = [...(info.dispositions ?? [])];
    let muxedFilename = info.metadata['filename'] ?? undefined;
    let muxedMimetype = info.metadata['mimetype'] ?? undefined;

    // Apply preprocess effect (codec changes etc.)
    if (preprocess) {
        const effect = simulatePreprocessEffect(preprocess as AudioPreprocess | VideoPreprocess);
        if (effect) {
            muxedCodecId = effect.codecId;
            muxedCodecName = effect.codecName;
        }
    }

    // Apply modify
    if (modify) {
        const result = applyStreamModify(muxedMetadata, muxedDispositions, modify as { title?: string; language?: string; disposition?: Record<string, boolean>; tags?: Record<string, string | undefined> });
        muxedMetadata = result.metadata;
        muxedDispositions = result.dispositions;
        // Re-derive filename/mimetype after modify (they might have been set in modify.tags)
        muxedFilename = muxedMetadata['filename'] ?? muxedFilename;
        muxedMimetype = muxedMetadata['mimetype'] ?? muxedMimetype;
    }

    return {
        demuxerMapKey: filePath,
        originalIndex: info.index,
        originalCodec,
        originalMetadata,
        originalDispositions,
        muxedCodecName,
        muxedCodecId,
        muxedMetadata,
        muxedDispositions,
        muxedFilename,
        muxedMimetype,
        muxedDelay: (modify?.delay as number | undefined) ?? 0,
        modify: modify as VideoModify | AudioModify | SubtitleModify | undefined,
        modifyType: type,
    };
}

// ─── Build TrackComparison[] ────────────────────────────────

function buildComparisons(streams: SimulatedStream[]): TrackComparison[] {
    const comparisons: TrackComparison[] = [];
    let outputIndex = 0;

    const codecTypeMap: Record<string, 'video' | 'audio' | 'subtitle' | 'attachment'> = {
        video: 'video',
        audio: 'audio',
        subtitle: 'subtitle',
        attachment: 'attachment',
    };

    // Add in order: video, audio, subtitle, attachment
    for (const type of ['video', 'audio', 'subtitle', 'attachment'] as const) {
        const typeStreams = streams
            .filter(s => s.modifyType === type)
            .sort((a, b) => a.originalIndex - b.originalIndex);
        simulateSortStreams(typeStreams);

        for (const s of typeStreams) {
            const originalCodecName = s.originalCodec ? getCodecName(s.originalCodec) ?? 'unknown' : 'unknown';
            comparisons.push({
                outputIndex: outputIndex++,
                codecType: codecTypeMap[type],
                demuxerMapKey: s.demuxerMapKey,
                originalIndex: s.originalIndex,
                originalCodec: originalCodecName,
                originalTitle: s.originalMetadata['title'] ?? undefined,
                originalLanguage: s.originalMetadata['language'] ?? undefined,
                originalDispositions: getDispositionNames(s.originalDispositions),
                muxedCodec: s.muxedCodecName || 'unknown',
                muxedTitle: s.muxedMetadata['title'] ?? undefined,
                muxedLanguage: s.muxedMetadata['language'] ?? undefined,
                muxedDispositions: getDispositionNames(s.muxedDispositions),
                muxedFilename: s.muxedFilename,
                muxedMimetype: s.muxedMimetype,
                muxedMetadata: { ...s.muxedMetadata },
                muxedDelay: s.muxedDelay ?? 0,
                // Mirrors the real muxer: subtitle compression defaults to on.
                ...(type === 'subtitle' && {
                    muxCompress: (s.modify as SubtitleModify | undefined)?.compress ?? true,
                }),
            });
        }
    }

    return comparisons;
}

/**
 * Extract a flat source selectors object from an Episode source entry.
 */
function extractSelectors(
    source: Episode['sources'][0],
): SourceSelectors {
    return {
        video: source.video?.map(item => ({
            match: item.match as Record<string, unknown> | undefined,
            modify: item.modify,
            preprocess: item.preprocess,
        })) ?? [],
        audio: source.audio?.map(item => ({
            match: item.match as Record<string, unknown> | undefined,
            modify: item.modify,
            preprocess: item.preprocess,
        })) ?? [],
        subtitle: source.subtitle?.map(item => ({
            match: item.match as Record<string, unknown> | undefined,
            modify: item.modify,
        })) ?? [],
        attachment: source.attachment?.map(item => ({
            match: item.match as Record<string, unknown> | undefined,
        })) ?? [],
    };
}

// ─── Main entry point ───────────────────────────────────────

/**
 * Build a MuxerModel from an Episode config and cached per-file StreamInfo[].
 *
 * @param episode       - The episode configuration (same shape as passed to EpisodeMuxer.init)
 * @param streamInfoMap - Map of resolved file path → StreamInfo[] (from cached probe results)
 * @param queueOverrides - Per-episode queue track overrides keyed by "demuxerMapKey:originalIndex"
 * @returns MuxerModel containing comparisons and stream infos
 */
export function buildEpisodeModel(
    episode: Episode,
    streamInfoMap: ReadonlyMap<string, StreamInfo[]>,
    _queueOverrides?: Record<string, PerTrackModifier>,
): MuxerModel {
    const allSimulatedStreams: SimulatedStream[] = [];
    const allStreamInfos: StreamInfo[] = [];

    for (const sourceEntry of episode.sources) {
        const filePath = path.resolve(sourceEntry.file.directory, sourceEntry.file.name);
        const streamInfos = streamInfoMap.get(filePath);
        if (!streamInfos) continue;

        allStreamInfos.push(...streamInfos);

        const selectors = extractSelectors(sourceEntry);
        const perTrackMods = sourceEntry.perTrackModifiers as Record<number, PerTrackModifier> | undefined;
        const excludedTracks = sourceEntry.excludedTracks;
        const matched = runSimulatedSelection(filePath, streamInfos, selectors, perTrackMods, excludedTracks);
        allSimulatedStreams.push(...matched);
    }

    const comparisons = buildComparisons(allSimulatedStreams);
    return { comparisons, streamInfos: allStreamInfos };
}

/**
 * Apply queue-level track overrides to an existing MuxerModel's comparisons.
 * This is called separately after buildEpisodeModel() since the caller
 * has the episode ID needed to look up the override block.
 *
 * Overrides are applied directly to the comparisons. Mutating the comparisons in place keeps every field intact.
 */
export function applyOverridesToModel(
    model: MuxerModel,
    queueOverrides: Record<string, PerTrackModifier> | undefined,
): MuxerModel {
    if (!queueOverrides) return model;

    for (const [stableKey, mod] of Object.entries(queueOverrides)) {
        // stableKey = "demuxerMapKey:originalIndex"
        const lastColon = stableKey.lastIndexOf(':');
        if (lastColon <= 0) continue;
        const mapKey = stableKey.slice(0, lastColon);
        const originalIdx = Number(stableKey.slice(lastColon + 1));

        const comp = model.comparisons.find(
            c => c.demuxerMapKey === mapKey && c.originalIndex === originalIdx,
        );
        if (!comp) continue;

        if (mod.title !== undefined) comp.muxedTitle = mod.title;
        if (mod.language !== undefined) comp.muxedLanguage = mod.language;
        if (mod.delay !== undefined) comp.muxedDelay = mod.delay;

        if (mod.disposition) {
            // Overrides are keyed by numeric AV_DISPOSITION_* value; comparisons
            // carry display names, so translate via getDispositionName.
            const enabled = new Set(comp.muxedDispositions);
            for (const [dispKey, isOn] of Object.entries(mod.disposition)) {
                const name = getDispositionName(Number(dispKey) as AVDisposition);
                if (!name) continue;
                if (isOn) enabled.add(name);
                else enabled.delete(name);
            }
            comp.muxedDispositions = [...enabled];
        }

        if (mod.tags) {
            comp.muxedMetadata = { ...(comp.muxedMetadata ?? {}), ...mod.tags };
        }

        // Queue-level compression override. Only meaningful for subtitle tracks;
        // `!== undefined` so an explicit false is honoured rather than dropped.
        if (mod.compress !== undefined && comp.codecType === 'subtitle') {
            comp.muxCompress = mod.compress;
        }
    }

    return model;
}
