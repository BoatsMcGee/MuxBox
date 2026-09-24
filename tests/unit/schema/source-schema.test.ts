import { describe, it, expect } from 'vitest';
import * as S from 'sury';
import { sourceSchema } from '@/lib/sury-schema';

const parseSource = S.parser(sourceSchema);

describe('sourceSchema', () => {
    it('accepts valid source with numeric codec IDs', () => {
        const validSource = {
            directory: '/path/to/source',
            file: { name: 'video.mkv' },
            match: '\\.mkv$',
            inheritFileName: true,
            episodeOffset: 0,
            video: [{
                match: { codec: { equal: 27 } },  // AV_CODEC_ID_H264 = 27
                modify: { language: 'eng' },
            }],
            audio: [{
                match: { codec: { equal: 86018 } }, // AV_CODEC_ID_AAC = 86018
                modify: { language: 'jpn' },
            }],
            subtitle: [],
            attachment: [],
        };
        
        const result = parseSource(validSource);
        expect(result.video[0].match.codec.equal).toBe(27);
        expect(result.audio[0].match.codec.equal).toBe(86018);
    });

    it('rejects source with string codec IDs in video match', () => {
        const invalidSource = {
            directory: '/path/to/source',
            file: { name: 'video.mkv' },
            video: [{
                match: { codec: { equal: 'H264' } },  // String not allowed
            }],
            audio: [],
            subtitle: [],
            attachment: [],
        };
        
        expect(() => parseSource(invalidSource)).toThrow();
    });

    it('rejects source with string codec IDs in audio match', () => {
        const invalidSource = {
            directory: '/path/to/source',
            file: { name: 'video.mkv' },
            video: [],
            audio: [{
                match: { codec: { equal: 'AAC' } },  // String not allowed
            }],
            subtitle: [],
            attachment: [],
        };
        
        expect(() => parseSource(invalidSource)).toThrow();
    });

    it('accepts source with excludedTracks', () => {
        const validSource = {
            directory: '/path/to/source',
            file: { name: 'video.mkv' },
            match: '\\.mkv$',
            inheritFileName: true,
            episodeOffset: 0,
            excludedTracks: {
                'video.mkv': [0, 2],
            },
            video: [],
            audio: [],
            subtitle: [],
            attachment: [],
        };
        
        const result = parseSource(validSource);
        expect(result.excludedTracks).toEqual({ 'video.mkv': [0, 2] });
    });

    it('rejects source with non-numeric excludedTracks', () => {
        const invalidSource = {
            directory: '/path/to/source',
            file: { name: 'video.mkv' },
            excludedTracks: {
                'video.mkv': ['a', 'b'],  // Strings not allowed
            },
            video: [],
            audio: [],
            subtitle: [],
            attachment: [],
        };
        
        expect(() => parseSource(invalidSource)).toThrow();
    });

    it('accepts complex selector operators for codec', () => {
        const validSource = {
            directory: '/path/to/source',
            file: { name: 'video.mkv' },
            video: [{
                match: {
                    codec: {
                        anyOf: [
                            { equal: 27 },   // H264
                            { equal: 173 },  // HEVC
                        ],
                    },
                },
            }],
            audio: [],
            subtitle: [],
            attachment: [],
        };
        
        const result = parseSource(validSource);
        expect(result.video[0].match.codec.anyOf).toHaveLength(2);
    });

    it('validates disposition selectors with numeric keys', () => {
        const validSource = {
            directory: '/path/to/source',
            file: { name: 'video.mkv' },
            video: [{
                match: {
                    disposition: {
                        '1': { equal: true },    // AV_DISPOSITION_DEFAULT = 1
                        '64': { equal: false },  // AV_DISPOSITION_FORCED = 64
                    },
                },
            }],
            audio: [],
            subtitle: [],
            attachment: [],
        };
        
        const result = parseSource(validSource);
        expect(result.video[0].match.disposition['1'].equal).toBe(true);
        expect(result.video[0].match.disposition['64'].equal).toBe(false);
    });

    it('validates video-specific fields (width, height, bitrate)', () => {
        const validSource = {
            directory: '/path/to/source',
            file: { name: 'video.mkv' },
            video: [{
                match: {
                    width: { greaterThan: 1920 },
                    height: { equal: 1080 },
                    bitrate: { lessThan: 50000000 },
                },
            }],
            audio: [],
            subtitle: [],
            attachment: [],
        };
        
        const result = parseSource(validSource);
        expect(result.video[0].match.width.greaterThan).toBe(1920);
        expect(result.video[0].match.height.equal).toBe(1080);
        expect(result.video[0].match.bitrate.lessThan).toBe(50000000);
    });

    it('validates audio-specific fields (channels)', () => {
        const validSource = {
            directory: '/path/to/source',
            file: { name: 'video.mkv' },
            video: [],
            audio: [{
                match: {
                    channels: { equal: 2 },
                    bitrate: { greaterThan: 128000 },
                },
            }],
            subtitle: [],
            attachment: [],
        };
        
        const result = parseSource(validSource);
        expect(result.audio[0].match.channels.equal).toBe(2);
        expect(result.audio[0].match.bitrate.greaterThan).toBe(128000);
    });

    it('validates attachment match fields', () => {
        const validSource = {
            directory: '/path/to/source',
            file: { name: 'video.mkv' },
            video: [],
            audio: [],
            subtitle: [],
            attachment: [{
                match: {
                    codec: { equal: 94208 },  // DVD subtitle
                    fileName: { pattern: '.*\\.ttf$' },
                    mimeType: { equal: 'application/x-truetype-font' },
                },
            }],
        };
        
        const result = parseSource(validSource);
        expect(result.attachment[0].match.codec.equal).toBe(94208);
        expect(result.attachment[0].match.fileName.pattern).toBe('.*\\.ttf$');
        expect(result.attachment[0].match.mimeType.equal).toBe('application/x-truetype-font');
    });

    it('rejects boolean for codec equal', () => {
        const invalidSource = {
            directory: '/path/to/source',
            file: { name: 'video.mkv' },
            video: [{
                match: { codec: { equal: true } },
            }],
            audio: [],
            subtitle: [],
            attachment: [],
        };
        
        expect(() => parseSource(invalidSource)).toThrow();
    });

    it('accepts per-file-only source', () => {
        const validSource = {
            directory: '/path/to/source',
            file: { name: 'video.mkv' },
            perFileMetadata: { 'ep01.mkv': true },
            perFileChapters: { 'ep01.mkv': true },
            perFileChapterDelay: { 'ep01.mkv': -250 },
            video: [],
            audio: [],
            subtitle: [],
            attachment: [],
        };

        const result = parseSource(validSource);
        expect(result.inheritMetadata).toBeUndefined();
        expect(result.chapters).toBeUndefined();
        expect(result.perFileMetadata).toEqual({ 'ep01.mkv': true });
        expect(result.perFileChapters).toEqual({ 'ep01.mkv': true });
        expect(result.perFileChapterDelay).toEqual({ 'ep01.mkv': -250 });
    });

    it('preserves per-file chapter delay overrides (including negatives)', () => {
        const validSource = {
            directory: '/path/to/source',
            file: { name: 'video.mkv' },
            perFileMetadata: { 'ep01.mkv': true },
            perFileChapters: { 'ep01.mkv': true },
            perFileChapterDelay: { 'ep01.mkv': -250, 'ep02.mkv': 1000 },
            perFileExcluded: { 'ep03.mkv': true },
            video: [],
            audio: [],
            subtitle: [],
            attachment: [],
        };

        const result = parseSource(validSource);
        expect(result.perFileMetadata).toEqual({ 'ep01.mkv': true });
        expect(result.perFileChapters).toEqual({ 'ep01.mkv': true });
        expect(result.perFileChapterDelay).toEqual({ 'ep01.mkv': -250, 'ep02.mkv': 1000 });
        expect(result.perFileExcluded).toEqual({ 'ep03.mkv': true });
    });

    it('preserves per-file season/episode overrides and track modifiers', () => {
        const validSource = {
            directory: '/path/to/source',
            file: { name: 'video.mkv' },
            perFileSeasonOverride: { 'ep01.mkv': 2 },
            perFileEpisodeOverride: { 'ep01.mkv': 5 },
            perTrackModifiers: {
                'ep01.mkv': {
                    0: { title: 'Main', delay: -120 },
                },
            },
            video: [],
            audio: [],
            subtitle: [],
            attachment: [],
        };

        const result = parseSource(validSource);
        expect(result.perFileSeasonOverride).toEqual({ 'ep01.mkv': 2 });
        expect(result.perFileEpisodeOverride).toEqual({ 'ep01.mkv': 5 });
        expect(result.perTrackModifiers?.['ep01.mkv']?.[0]?.title).toBe('Main');
        expect(result.perTrackModifiers?.['ep01.mkv']?.[0]?.delay).toBe(-120);
    });
});