import { TMDB } from '@api-wrappers/tmdb-wrapper';
import { type TmdbSearchResult, type TmdbSeriesCache } from './types.js';
export * from './types.js';

const DEFAULT_TOKEN = process.env.TMDB_ACCESS_TOKEN ?? '';

function getClient(token?: string): TMDB {
    return new TMDB(token || DEFAULT_TOKEN);
}

/**
 * Search for TV series on TMDB.
 * Returns a list of matching series with basic info.
 */
export async function searchSeries(query: string, token?: string): Promise<TmdbSearchResult[]> {
    const tmdb = getClient(token);
    const results = await tmdb.search.tv({ query });
    return (results.results ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        firstAirDate: r.first_air_date,
        posterPath: r.poster_path ?? undefined,
        overview: r.overview,
    }));
}

/**
 * Get full series details including all seasons and episodes.
 * Fetches from TMDB API and returns structured cache data.
 */
export async function getSeriesDetails(seriesId: number, token?: string): Promise<TmdbSeriesCache> {
    const tmdb = getClient(token);
    const details = await tmdb.tvShows.details(seriesId);
    const seasons = details.seasons ?? [];

    const seasonsMap: TmdbSeriesCache['seasons'] = {};
    // Fetch all seasons including season 0 (specials) in parallel
    const seasonDetailsPromises = seasons.map(async (season) => {
        const seasonNum = season.season_number;
        const seasonDetails = await tmdb.tvSeasons.details({
            tvShowID: seriesId,
            seasonNumber: seasonNum,
        });
        return { seasonNum, seasonDetails, season };
    });
    const seasonDetailsResults = await Promise.all(seasonDetailsPromises);

    for (const { seasonNum, seasonDetails, season } of seasonDetailsResults) {

        const episodesMap: Record<number, TmdbSeriesCache['seasons'][number]['episodes'][number]> = {};
        for (const ep of seasonDetails.episodes ?? []) {
            episodesMap[ep.episode_number] = {
                id: ep.id,
                name: ep.name,
                overview: ep.overview,
                airDate: ep.air_date,
                episodeNumber: ep.episode_number,
            };
        }

        seasonsMap[seasonNum] = {
            id: season.id,
            name: season.name,
            seasonNumber: seasonNum,
            episodes: episodesMap,
        };
    }

    return {
        id: details.id,
        name: details.name,
        posterPath: details.poster_path ?? undefined,
        overview: details.overview,
        firstAirDate: details.first_air_date,
        seasons: seasonsMap,
    };
}
