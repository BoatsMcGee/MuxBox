/**
 * Seeds `tests/integration/appdata` (the redirected Electron userData root)
 * before the app launches. The app itself is never involved — we write the
 * exact JSON files the preload layer reads:
 *   - settings.json
 *   - projects/index.json + projects/<id>.json  ({data, travels})
 *   - tmdb-cache/<seriesId>.json
 *
 * Seeded state backs the screenshot specs:
 *   - "How"   — the fully configured showcase project (source, tags, rename…)
 *   - "New Project" — untouched default project for the `project/empty` shot
 */
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type {TmdbSeriesCache} from '@app/tmdb';

export const APPDATA_DIR = path.join(process.cwd(), 'tests', 'integration', 'appdata');
export const PROJECT_HOW_ID = 'how';
export const PROJECT_NEW_ID = 'new-project';
/** How It's Made on TMDB (76331 is Succession — verify via themoviedb.org/search). */
export const TMDB_SERIES_ID = 1749;
export const HOW_IT_IS_MADE = "How It's Made";

// The corpus path as the tests see it (absolute, native separators).
export function corpusVideoDir(): string {
    return path.join(process.cwd(), 'tests', 'integration', 'corpus', 'Video');
}

interface ProjectListItemSeed {
    id: string;
    name: string;
    seriesName: string;
    sourceCount: number;
    episodeCount: number;
    lastOpened: number;
    createdAt: number;
}

function howProjectData() {
    const now = Date.now();
    return {
        id: PROJECT_HOW_ID,
        name: 'How',
        seriesName: HOW_IT_IS_MADE,
        seasonNames: {0: 'Special Editions'},
        rename: {
            enabled: true,
            template: '{{SEASON_NUMBER}}{{EPISODE_NUMBER}} - {{EPISODE_NAME}}',
            fieldConfig: {
                '{{SEASON_NUMBER}}': {prefix: 'S', suffix: '', alwaysAdd: false, padding: 2},
                '{{EPISODE_NUMBER}}': {prefix: 'E', suffix: '', alwaysAdd: false, padding: 2},
            },
        },
        muxOptions: {
            overwrite: false,
            modifyTags: {type: 'TV'},
        },
        sources: [
            {
                directory: corpusVideoDir(),
                match: {
                    regex: 's([0-9]+)e([0-9]+)',
                    regexFlags: 'i',
                    episodeIndex: 2,
                    seasonIndex: 1,
                },
                inheritFileName: false,
                // Named match items — they back the builder screenshots.
                video: [{name: 'H264 AVC - English', match: {}}],
                audio: [
                    {name: 'AAC 5.1 Surround', match: {}},
                    {name: 'FLAC Stereo', match: {}},
                ],
                // tlh (Klingon) matches nothing in the corpus → red "not matched".
                subtitle: [{name: 'tlh - Not English', match: {language: {equal: 'tlh'}}}],
                attachment: [{name: 'All Attachments', match: {}}],
                // Episode 1 ships chapters (enabled + shifted) so the queue's
                // Chapters section has rows before the source page runs.
                perFileChapters: {'How Its Made s01e01.mkv': true},
                perFileChapterDelay: {'How Its Made s01e01.mkv': 500},
            },
        ],
        outputDirectory: 'C:/TV',
        tmdbSeriesId: TMDB_SERIES_ID,
        tmdbSeriesName: HOW_IT_IS_MADE,
        createdAt: now - 86_400_000,
        updatedAt: now - 3_600_000,
    };
}

function newProjectData() {
    const now = Date.now();
    return {
        id: PROJECT_NEW_ID,
        name: 'New Project',
        seriesName: '',
        seasonNames: {0: 'Specials'},
        rename: {
            enabled: true,
            template: '{{SERIES_NAME}} - {{SEASON_NUMBER}}{{EPISODE_NUMBER}} - {{EPISODE_NAME}}',
            fieldConfig: {
                '{{SEASON_NUMBER}}': {prefix: 'S', suffix: '', alwaysAdd: false, padding: 2},
                '{{EPISODE_NUMBER}}': {prefix: 'E', suffix: '', alwaysAdd: false, padding: 2},
            },
        },
        muxOptions: {overwrite: false},
        sources: [],
        createdAt: now - 7_200_000,
        updatedAt: now - 7_200_000,
    };
}

/** The REAL TMDB cache for How It's Made (id 1749) — a committed JSON fixture
 *  produced by @app/tmdb getSeriesDetails() against the live API: all 33
 *  seasons (0–32), real season/episode ids, titles, air dates, overview and
 *  first air date. It contains only public TMDB data — never a token — so the
 *  suite stays hermetic (no network, no secret in the repo). */
function tmdbSeriesCache(): TmdbSeriesCache {
    const file = path.join(process.cwd(), 'tests', 'integration', `tmdb-cache-${TMDB_SERIES_ID}.json`);
    return JSON.parse(readFileSync(file, 'utf8')) as TmdbSeriesCache;
}

/**
 * Reset and populate the tests/integration/appdata directory.
 * Called from global-setup before the Electron app launches.
 */
export function seedAppData(): void {
    rmSync(APPDATA_DIR, {recursive: true, force: true});
    mkdirSync(APPDATA_DIR, {recursive: true});

    writeFileSync(
        path.join(APPDATA_DIR, 'settings.json'),
        JSON.stringify({
            tmdbAccessToken: 'integration-test-tmdb-token',
            theme: 'light',
            windowWidth: 1920,
            windowHeight: 1080,
            windowX: null,
            windowY: null,
            windowIsMaximized: false,
            multiplexerMethod: {keepNegativePackets: false, clipTimestamps: false},
            muxingConcurrency: 2,
        }, null, 2),
        'utf8',
    );

    const projectsDir = path.join(APPDATA_DIR, 'projects');
    mkdirSync(projectsDir, {recursive: true});

    const index: ProjectListItemSeed[] = [
        {
            id: PROJECT_HOW_ID,
            name: 'How',
            seriesName: HOW_IT_IS_MADE,
            sourceCount: 1,
            episodeCount: 4,
            lastOpened: Date.now(),
            createdAt: Date.now() - 86_400_000,
        },
        {
            id: PROJECT_NEW_ID,
            name: 'New Project',
            seriesName: '',
            sourceCount: 0,
            episodeCount: 0,
            lastOpened: Date.now() - 60_000,
            createdAt: Date.now() - 7_200_000,
        },
    ];
    writeFileSync(path.join(projectsDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
    writeFileSync(
        path.join(projectsDir, `${PROJECT_HOW_ID}.json`),
        JSON.stringify({data: howProjectData(), travels: null}, null, 2),
        'utf8',
    );
    writeFileSync(
        path.join(projectsDir, `${PROJECT_NEW_ID}.json`),
        JSON.stringify({data: newProjectData(), travels: null}, null, 2),
        'utf8',
    );

    const tmdbDir = path.join(APPDATA_DIR, 'tmdb-cache');
    mkdirSync(tmdbDir, {recursive: true});
    writeFileSync(
        path.join(tmdbDir, `${TMDB_SERIES_ID}.json`),
        JSON.stringify(tmdbSeriesCache(), null, 2),
        'utf8',
    );
}
