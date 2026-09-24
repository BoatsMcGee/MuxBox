export interface TmdbSeriesCache {
    id: number;
    name: string;
    posterPath?: string;
    overview?: string;
    firstAirDate?: string;
    seasons: Record<number, TmdbSeasonCache>;
}

export interface TmdbSeasonCache {
    id: number;
    name?: string;
    seasonNumber: number;
    episodes: Record<number, TmdbEpisodeCache>;
}

export interface TmdbEpisodeCache {
    id: number;
    name?: string;
    overview?: string;
    airDate?: string;
    episodeNumber: number;
}

export interface TmdbSearchResult {
    id: number;
    name: string;
    firstAirDate?: string;
    posterPath?: string;
    overview?: string;
}
