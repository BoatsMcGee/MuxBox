import type { MuxOptions as MuxerOptions, Source as MuxerSource, PerTrackModifier } from '@app/muxer';

export type { MuxerOptions as MuxerMuxOptions, MuxerSource };

export interface FieldConfig {
    prefix: string;
    suffix: string;
    alwaysAdd: boolean;
    /** Minimum zero-padding for numeric fields (season/episode numbers). Default 2. */
    padding?: number;
}

export interface ProjectData {
    id: string;
    name: string;
    seriesName: string;
    /** Custom season names keyed by season number.
     *  Season 0 defaults to "Specials", season 1+ to "Season {N}".
     *  Season 0 uses just the name as the folder name.
     *  Seasons 1+ use "Season {N} - {name}" format. */
    seasonNames?: Record<number, string>;
    rename: {
        enabled: boolean;
        template: string;
        tags?: Record<string, string | undefined>;
        /** Per-field prefix/suffix/always-add/padding configuration keyed by template tag (e.g. "{{SEASON_NUMBER}}"). */
        fieldConfig?: Record<string, FieldConfig>;
        /** Per-episode filename overrides keyed by episode ID.
         *  When set, the episode uses this basename (no extension) instead of the rename template. */
        filenameOverrides?: Record<string, string>;
    };
    muxOptions: MuxerOptions;
    sources: MuxerSource[];
    tmdbSeriesId?: number;
    tmdbSeriesName?: string;
    /** Custom output directory. If not set, the file is written next to the source file. */
    outputDirectory?: string;
    /** Per-episode title overrides keyed by "season-episode" (e.g. "0-8"). */
    episodeNameOverrides?: Record<string, string>;
    /**
     * Per-episode, per-track metadata overrides made from the Episode Queue.
     * Keyed by episode ID (e.g. "sourceDir::filename" or "merged:1-3"),
     * then by stable track identifier "demuxerMapKey:originalIndex".
     *
     * On muxer rebuild, these are reapplied via the preload metadata update functions
     * after init + preprocess so user edits survive source reconfiguration.
     */
    queueTrackOverrides?: Record<string, Record<string, PerTrackModifier>>;
    createdAt: number;
    updatedAt: number;
}

export interface ProjectListItem {
    id: string;
    name: string;
    seriesName: string;
    sourceCount: number;
    episodeCount: number;
    lastOpened: number;
    createdAt: number;
}
export function createDefaultProjectData(id: string): ProjectData {
    return {
        id,
        name: 'New Project',
        seriesName: '',
        seasonNames: { 0: 'Specials' },
        rename: {
            enabled: true,
            template: '{{SERIES_NAME}} - {{SEASON_NUMBER}}{{EPISODE_NUMBER}} - {{EPISODE_NAME}}',
            fieldConfig: {
                '{{SEASON_NUMBER}}': { prefix: 'S', suffix: '', alwaysAdd: false },
                '{{EPISODE_NUMBER}}': { prefix: 'E', suffix: '', alwaysAdd: false },
            },
        },
        muxOptions: {
            overwrite: false,
        },
        sources: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}
