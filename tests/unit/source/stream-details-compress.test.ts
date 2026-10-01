import { describe, it, expect, vi, beforeEach } from 'vitest';

// getStreamDetails → stream-match.ts (getCodecEntryList) → @app/preload.
// In the node test env the preload browser build reads from globalThis,
// which is undefined — stub the bridge so codec-map init resolves.
vi.mock('@app/preload', () => ({
    getCodecEntryList: vi.fn(async () => [
        { id: 1, varName: 'AV_CODEC_ID_SUBRIP', friendlyName: 'SubRip' },
        { id: 2, varName: 'AV_CODEC_ID_ASS', friendlyName: 'ASS' },
        { id: 3, varName: 'AV_CODEC_ID_HDMV_PGS_SUBTITLE', friendlyName: 'HDMV PGS' },
    ]),
}));

import { getStreamDetails } from '@/components/source/composables/useStreamMatchPreview';
import { isTextSubtitleCodec } from '@/lib/stream-match';
import type { StreamInfo } from '@app/preload';

const SUBRIP = 1;
const PGS = 3;

function makeStreamInfo(
    codecType: number,
    codecId: number,
    codecName = 'subrip',
    extra?: Record<string, unknown>,
): StreamInfo {
    return {
        index: 1,
        codecType,
        codecId,
        codecName,
        metadata: {},
        dispositions: [],
        extra,
    } as StreamInfo;
}

describe('getStreamDetails zlib compression row', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('defaults to zlib for a text subtitle track with no explicit setting', () => {
        const details = getStreamDetails(makeStreamInfo(3, SUBRIP), undefined, undefined, 'ep01.mkv', 1, {});
        const row = details.find(d => d.label === 'zlib Compression');
        expect(row).toBeDefined();
        expect(row?.value).toBe('zlib');
        expect(row?.overridable).toBe(true);
        expect(row?.overridden).toBe(false);
    });

    it('shows none when modify.compress is false', () => {
        const details = getStreamDetails(makeStreamInfo(3, SUBRIP), { compress: false }, undefined, 'ep01.mkv', 1, {});
        const row = details.find(d => d.label === 'zlib Compression');
        expect(row?.value).toBe('none');
    });

    it('lets a per-track override win over modify.compress', () => {
        const mods = { 'ep01.mkv': { 1: { compress: false } } };
        const details = getStreamDetails(makeStreamInfo(3, SUBRIP), { compress: true }, undefined, 'ep01.mkv', 1, mods);
        const row = details.find(d => d.label === 'zlib Compression');
        expect(row?.value).toBe('none');
        expect(row?.overridden).toBe(true);
        expect(row?.overrideField).toBe('compress');
        expect(row?.overrideValue).toBe(false);
    });

    it('omits the row entirely for bitmap subtitle codecs', () => {
        const details = getStreamDetails(
            makeStreamInfo(3, PGS, 'hdmv_pgs_subtitle'),
            undefined,
            undefined,
            'ep01.mkv',
            1,
            {},
        );
        expect(details.find(d => d.label === 'zlib Compression')).toBeUndefined();
    });

    it('never renames the pre-existing MediaInfo compression row', () => {
        const details = getStreamDetails(
            makeStreamInfo(3, SUBRIP),
            undefined,
            undefined,
            'ep01.mkv',
            1,
            {},
        );
        // The MediaInfo "Codec Compression" row must keep its own label so the
        // two concepts are not confused.
        expect(details.some(d => d.label === 'Compression')).toBe(false);
    });
});

describe('isTextSubtitleCodec', () => {
    // These are the muxer package's `getCodecName()` aliases (e.g. SUBRIP, WEBVTT),
    // not FFmpeg's raw codec names — see packages/muxer/src/ffmpeg/codec-names.ts.
    it('accepts text-based subtitle codec names', () => {
        for (const name of ['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'text', 'usf']) {
            expect(isTextSubtitleCodec(0, name)).toBe(true);
        }
    });

    it('rejects the MOV alias, which is too ambiguous to treat as text', () => {
        // getCodecName() maps AV_CODEC_ID_MOV_TEXT → 'MOV', which carries no
        // indication that it is a subtitle codec, so it is deliberately excluded.
        expect(isTextSubtitleCodec(0, 'MOV')).toBe(false);
    });

    it('rejects bitmap subtitle codec names', () => {
        for (const name of [
            'hdmv_pgs_subtitle',
            'dvd_subtitle',
            'dvb_subtitle',
            'xsub',
            'dvd_subtitle ',
        ]) {
            expect(isTextSubtitleCodec(0, name)).toBe(false);
        }
    });

    it('is case-insensitive and trims whitespace', () => {
        expect(isTextSubtitleCodec(0, 'SubRip')).toBe(true);
        expect(isTextSubtitleCodec(0, '  ASS  ')).toBe(true);
    });

    it('falls back to the codec entry list when no name is given', () => {
        expect(isTextSubtitleCodec(SUBRIP)).toBe(true);
        expect(isTextSubtitleCodec(PGS)).toBe(false);
    });
});
