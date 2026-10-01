import * as fs from 'fs';
import * as path from 'path';
import { filenameParse, type ParsedShow } from '@ctrl/video-filename-parser';
import sanitize from 'sanitize-filename';
import { mkvmergeChapters } from '@app/mkvtoolnix';
import { type ProcessingOptions, type Source } from '../types.js';
import { tryParseRegex } from '../@utils/index.js';
import {
    type Episode,
    type PreprocessingProgressEvent,
    type PreprocessingCompleteEvent,
    type SkippedEvent,
    type MkvmergeStartEvent,
    type MkvmergeCompleteEvent,
} from './types.js';
import { EpisodeMuxer } from './muxer.js';
import { type MuxSnapshot, type TrackComparison } from './progress.js';
export * from './types.js';
export * from './muxer.js';
export * from './progress.js';
export * from './stream-props.js';
export { buildEpisodeModel, applyOverridesToModel } from './simulator.js';

export async function generateSeasonMap(
    sources: Source[],
    outputFolder: string,
    options: ProcessingOptions,
): Promise<{ data: Record<number, Record<number, Episode>>, warnings: string[] }> {
    const warnings: string[] = [];
    const seasonMap: Record<number, Record<number, Episode>> = {};

    for (const source of sources) {
        let sourceFiles: string[];
        try {
            sourceFiles = fs.readdirSync(source.directory);
        } catch (err) {
            throw new Error(`Failed to read directory ${source.directory}: ${err}`, { cause: err });
        }

        for await (const sourceFile of sourceFiles) {
            // ── Skip excluded files ──────────────────────────────────────
            if (source.perFileExcluded?.[sourceFile]) {
                continue;
            }

            // ── Extract episode/season numbers ───────────────────────────
            let seasonNumber: number | undefined;
            let episodeNumber: number | undefined;

            // If source.match (EpisodeMatch) is defined, attempt regex extraction
            if (source.match) {
                // source.match.regex is always a string (new format: plain pattern,
                // legacy format: "/pattern/flags"). Try to parse with regexFlags if available.
                const rawRegex = String(source.match.regex);
                const flags = source.match.regexFlags ?? '';
                let regex: RegExp | null;

                if (rawRegex.startsWith('/')) {
                    // Legacy format: "/pattern/flags" — extract from the string
                    const lastSlash = rawRegex.lastIndexOf('/');
                    const pattern = rawRegex.slice(1, lastSlash);
                    const legacyFlags = rawRegex.slice(lastSlash + 1) || flags;
                    regex = tryParseRegex(pattern, legacyFlags);
                } else {
                    regex = tryParseRegex(rawRegex, flags);
                }

                if (!regex) {
                    warnings.push(`Invalid regex in source match for ${sourceFile} in ${source.directory}`);
                    continue;
                }
                const matchResult = sourceFile.match(regex);
                if (!matchResult) {
                    continue; // File doesn't match the regex, skip
                }

                // Extract episode number from configured capture group
                const episodeStr = matchResult[source.match.episodeIndex];
                if (episodeStr !== undefined) {
                    const parsed = parseInt(episodeStr, 10);
                    if (!isNaN(parsed)) {
                        episodeNumber = parsed;
                    }
                }

                // Optionally extract season number from configured capture group
                if (source.match.seasonIndex !== undefined) {
                    const seasonStr = matchResult[source.match.seasonIndex];
                    if (seasonStr !== undefined) {
                        const parsed = parseInt(seasonStr, 10);
                        if (!isNaN(parsed)) {
                            seasonNumber = parsed;
                        }
                    }
                }

                // Apply episode offset
                if (episodeNumber !== undefined) {
                    episodeNumber += source.episodeOffset ?? 0;
                }
            }

            // Fall back to filenameParse if regex-based extraction didn't determine episode number
            if (episodeNumber === undefined) {
                const parsedFileName = filenameParse(sourceFile, true) as ParsedShow;
                if (seasonNumber === undefined) {
                    seasonNumber = parsedFileName.seasons[0];
                }
                episodeNumber = parsedFileName?.episodeNumbers?.length && parsedFileName.episodeNumbers[0]
                    ? parsedFileName.episodeNumbers[0] + (source.episodeOffset ?? 0)
                    : undefined;
            }

            // ── Season number precedence ─────────────────────────────────
            // Order: source.season > perFileSeasonOverride > regex-extracted > directory-detected > default 1
            if (source.season !== undefined) {
                seasonNumber = source.season;
            }
            if (source.perFileSeasonOverride?.[sourceFile] !== undefined) {
                seasonNumber = source.perFileSeasonOverride[sourceFile];
            }
            seasonNumber = seasonNumber ?? 1;

            // ── Episode override check ───────────────────────────────────
            // Per-file override takes highest precedence (applied after episodeOffset)
            if (source.perFileEpisodeOverride?.[sourceFile] !== undefined) {
                episodeNumber = source.perFileEpisodeOverride[sourceFile];
            }

            // ── Guard: episode number required ───────────────────────────
            if (episodeNumber === undefined) {
                warnings.push(`No episode number found! Skipping ${sourceFile} in ${source.directory}`);
                continue;
            }

            const seasonName = options.series.seasonNames[seasonNumber];
            const seasonFolderName = sanitize(seasonName ? seasonNumber === 0 ? seasonName : `Season ${seasonNumber} - ${seasonName}` : `Season ${seasonNumber}`);

            if (!seasonMap[seasonNumber]) {
                seasonMap[seasonNumber] = {};
            }
            const episodeMap = seasonMap[seasonNumber] ?? {};
            let episode = episodeMap[episodeNumber];
            if (!episode) {
                episode = {
                    file: {
                        directory: path.resolve(outputFolder, sanitize(options.series.name), `${seasonFolderName}`),
                        name: `${sourceFile}`,
                        overwrite: options.muxOptions?.overwrite,
                        rename: { ...options.rename }, // Spread copy to avoid mutating the original options.rename object
                    },
                    method: options.method,
                    ...options.muxOptions?.modifyTags && { modifyTags: options.muxOptions.modifyTags },
                    series: {
                        name: options.series.name,
                        season: {
                            number: seasonNumber,
                            name: seasonName,
                        },
                        episode: {
                            number: episodeNumber,
                            name: options.series.episodeNames[seasonNumber][episodeNumber - 1],
                        },
                    },
                    sources: [],
                } as Episode;
                episodeMap[episodeNumber] = episode;
            }

            if (source.inheritFileName && path.resolve(source.directory) !== episode.file.directory) {
                const fileName = path.basename(sourceFile, path.extname(sourceFile));
                if (!episode.file.rename) {
                    episode.file.rename = {
                        template: fileName,
                    };
                }
                episode.file.rename.template = fileName;
            }

            const metadataEnabled = source.perFileMetadata?.[sourceFile] ?? false;
            const chaptersEnabled = source.perFileChapters?.[sourceFile] ?? false;
            const effectiveChapterDelay = source.perFileChapterDelay?.[sourceFile];

            episode.sources.push({
                file: {
                    directory: source.directory,
                    name: sourceFile,
                },
                ...(chaptersEnabled && {
                    chapters: {
                        ...(effectiveChapterDelay !== undefined && { delay: effectiveChapterDelay }),
                    },
                }),
                ...(metadataEnabled && {
                    inheritMetadata: true,
                }),
                ...source.perTrackModifiers && {
                    perTrackModifiers: source.perTrackModifiers,
                },
                ...source.excludedTracks?.[sourceFile] && {
                    excludedTracks: source.excludedTracks[sourceFile],
                },
                video: source.video,
                audio: source.audio,
                subtitle: source.subtitle,
                attachment: source.attachment,
            });

            episodeMap[episodeNumber] = episode;
        }
    }

    return {
        data: seasonMap,
        warnings,
    };
}

/**
 * Process a single episode:
 *   1. Init EpisodeMuxer (opens demuxers, builds selectors)
 *   2. Preprocess (selects streams, runs opusenc etc.)
 *   3. Mux (streaming k-way merge with progress events)
 *   4. Post-process with mkvmerge (chapters)
 *
 * Emits events:
 *   - tracks:ready(tracks) — track comparisons available
 *   - mux:progress(snapshot) — every 250ms during mux
 *   - mux:complete(snapshot) — mux finished successfully
 *   - mux:error(snapshot) — mux failed
 *   - skipped(reason) — episode skipped (exists already, no video, etc.)
 *   - mkvmerge:start(filePath)
 *   - mkvmerge:complete(fileName)
 */
export async function processEpisode(
    episode: Episode,
    listeners?: {
        onTracksReady?: (tracks: TrackComparison[]) => void;
        onMuxProgress?: (snapshot: MuxSnapshot) => void;
        onMuxComplete?: (snapshot: MuxSnapshot) => void;
        onMuxError?: (snapshot: MuxSnapshot) => void;
        onSkipped?: (reason: string) => void;
        onPreprocessingProgress?: (data: PreprocessingProgressEvent) => void;
        onPreprocessingComplete?: (data: PreprocessingCompleteEvent) => void;
    },
    options?: { signal?: AbortSignal },
): Promise<string | undefined> {
    await using episodeMuxer = await EpisodeMuxer.init(episode);

    // Wire up cancellation signal
    if (options?.signal) {
        options.signal.addEventListener('abort', () => {
            episodeMuxer.cancel(options.signal!.reason?.toString() ?? 'cancelled');
        }, { once: true });
    }

    // Wire up event listeners
    if (listeners?.onTracksReady) {
        episodeMuxer.on('tracks:ready', listeners.onTracksReady);
    }
    if (listeners?.onMuxProgress) {
        episodeMuxer.on('mux:progress', listeners.onMuxProgress);
    }
    if (listeners?.onMuxComplete) {
        episodeMuxer.on('mux:complete', listeners.onMuxComplete);
    }
    if (listeners?.onMuxError) {
        episodeMuxer.on('mux:error', listeners.onMuxError);
    }
    if (listeners?.onSkipped) {
        episodeMuxer.on('skipped', (data: SkippedEvent) => listeners.onSkipped!(data.reason));
    }
    if (listeners?.onPreprocessingProgress) {
        episodeMuxer.on('preprocessing:progress', listeners.onPreprocessingProgress);
    }
    if (listeners?.onPreprocessingComplete) {
        episodeMuxer.on('preprocessing:complete', listeners.onPreprocessingComplete);
    }

    // Phase 1: Preprocess
    await episodeMuxer.preprocess();

    // Phase 2: Mux
    const fileName = await episodeMuxer.mux();

    if (!fileName) {
        return undefined;
    }

    // Phase 3: Post-process with mkvmerge (chapters)
    const filePath = path.resolve(episode.file.directory, `${fileName}.mkv`);

    episodeMuxer.emit('mkvmerge:start', {
        filePath,
    } as MkvmergeStartEvent);

    const chaptersSources = episode.chaptersSource
        ? [{ path: path.resolve(episode.chaptersSource.directory, episode.chaptersSource.fileName), delay: episode.chaptersSource.delay }]
        : episode.sources
            .filter(source => source.chapters)
            .map(source => ({
                path: path.resolve(source.file.directory, source.file.name),
                delay: source.chapters?.delay,
            }));

    await mkvmergeChapters(filePath, chaptersSources, episodeMuxer.compressibleSubtitleTrackIds);

    episodeMuxer.emit('mkvmerge:complete', {
        fileName,
    } as MkvmergeCompleteEvent);

    return fileName;
}
