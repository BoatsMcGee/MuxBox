/**
 * Lazy test-corpus generator for the integration test suite.
 *
 * Encoding is split into two phases to keep regeneration fast:
 *   1. `_base/` — expensive encodes (AVC, HEVC, FLAC, AAC stereo/5.1/commentary)
 *      run ONCE and are reused by every episode.
 *   2. Episodes — assembled from the base streams with `ffmpeg -c copy`
 *      (remux only, seconds each), adding subtitles, chapters and attachments.
 *
 * Everything lives under `tests/integration/corpus/` (gitignored). A `.stamp`
 * file records the generator version; when it changes the whole corpus is
 * rebuilt. All media is synthesized — no copyrighted content is involved.
 *
 * Invoked from tests/integration/global-setup.ts (Playwright transpiles the TS).
 */
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {ffmpegPath} from 'node-av/ffmpeg';

export const CORPUS_ROOT = path.join(process.cwd(), 'tests', 'integration', 'corpus');
export const VIDEO_DIR = path.join(CORPUS_ROOT, 'Video');
export const SPECIALS_DIR = path.join(CORPUS_ROOT, 'Specials');
const BASE_DIR = path.join(CORPUS_ROOT, '_base');
const SUBS_DIR = path.join(BASE_DIR, 'subs');
const ATTACH_DIR = path.join(BASE_DIR, 'attachments');
const STAMP_PATH = path.join(CORPUS_ROOT, '.stamp');
const STAMP_VERSION = 'muxbox-corpus-v1';

// ─── Base assets ────────────────────────────────────────────────

const BASE_AUDIO_FILES = {
    flac: 'audio-flac.flac',
    aacstereo: 'audio-aac-stereo.m4a',
    aac51: 'audio-aac-51.m4a',
    commentary: 'audio-commentary.m4a',
} as const;

type AudioKey = keyof typeof BASE_AUDIO_FILES;

interface SubSpec {
    /** srt file key (without extension) inside `_base/subs`. */
    key: string;
    /** BCP-47 / ISO language tag written to the MKV track. */
    lang: string;
    /** Optional MKV track title. */
    title?: string;
    /** MKV disposition value ('0' clears all flags). */
    disposition?: string;
    /** Accepted alternates for verification (ffmpeg may normalize tags). */
    langAlternates?: string[];
    /** Source format. SubRip is the default; `ass` styles its own .ass file. */
    format?: 'srt' | 'ass';
    /** Expected codec after muxing (verification only). */
    expectCodec?: string;
}

interface EpisodeSpec {
    file: string;
    dir: string;
    video: 'avc' | 'hevc';
    audio: AudioKey[];
    subs: SubSpec[];
    attachments: string[];
    chapters: boolean;
    /** Container title. */
    title: string;
}

const SUBS: Record<string, SubSpec> = {
    eng: {key: 'eng', lang: 'eng', disposition: '0'},
    engSdh: {
        key: 'eng-sdh', lang: 'eng', title: 'English SDH',
        disposition: 'hearing_impaired',
    },
    engForced: {key: 'eng-forced', lang: 'eng', disposition: 'forced'},
    esES: {key: 'es-ES', lang: 'es-ES', disposition: '0', langAlternates: ['spa', 'esp']},
    es419: {key: 'es-419', lang: 'es-419', disposition: '0', langAlternates: ['spa', 'esp']},
    zhHans: {key: 'zh-Hans', lang: 'zh-Hans', disposition: '0', langAlternates: ['chi', 'zho']},
    zhHant: {key: 'zh-Hant', lang: 'zh-Hant', disposition: '0', langAlternates: ['chi', 'zho']},
    enUK: {key: 'en-UK', lang: 'en-UK', disposition: '0', langAlternates: ['eng']},
    // Styled text subs (second TEXT codec). Compression is eligible here.
    enStyled: {key: 'en-styled', lang: 'eng', title: 'English Styled', format: 'ass', expectCodec: 'ass'},
};

const EPISODES: EpisodeSpec[] = [
    {
        file: 'How Its Made s01e01.mkv', dir: VIDEO_DIR, video: 'avc',
        audio: ['flac', 'aac51', 'commentary'],
        subs: [SUBS.eng!, SUBS.engSdh!, SUBS.engForced!, SUBS.esES!, SUBS.es419!, SUBS.zhHans!, SUBS.zhHant!, SUBS.enUK!, SUBS.enStyled!],
        attachments: ['font.ttf', 'notes.txt'], chapters: true,
        title: "How It's Made - S01E01",
    },
    {
        file: 'How Its Made s01e02.mkv', dir: VIDEO_DIR, video: 'avc',
        audio: ['aacstereo'], subs: [SUBS.eng!, SUBS.esES!],
        attachments: [], chapters: true,
        title: "How It's Made - S01E02",
    },
    {
        file: 'How Its Made s01e03.mkv', dir: VIDEO_DIR, video: 'hevc',
        audio: ['flac'], subs: [SUBS.eng!, SUBS.zhHans!, SUBS.zhHant!],
        attachments: [], chapters: true,
        title: "How It's Made - S01E03",
    },
    {
        file: 'How Its Made s01e04.mkv', dir: VIDEO_DIR, video: 'avc',
        audio: ['aacstereo', 'commentary'],
        subs: [SUBS.eng!, SUBS.enUK!, SUBS.es419!],
        attachments: ['notes.txt'], chapters: false,
        title: "How It's Made - S01E04",
    },
    {
        file: 'How Its Made s00e02.mkv', dir: SPECIALS_DIR, video: 'avc',
        audio: ['flac'], subs: [SUBS.eng!, SUBS.esES!, SUBS.zhHant!],
        attachments: [], chapters: true,
        title: "How It's Made - S00E02",
    },
    {
        file: 'How Its Made s00e03.mkv', dir: SPECIALS_DIR, video: 'avc',
        audio: ['aacstereo'], subs: [SUBS.eng!],
        attachments: [], chapters: false,
        title: "How It's Made - S00E03",
    },
];

// ─── FFmpeg helpers ─────────────────────────────────────────────

function runFfmpeg(args: string[]): Promise<{stderr: string; code: number}> {
    return new Promise((resolve, reject) => {
        const proc = spawn(ffmpegPath(), args, {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
        let stderr = '';
        proc.stdout.on('data', () => {/* captures nothing at loglevel error */},
        );
        proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code === 0) resolve({stderr, code: code ?? 0});
            else reject(new Error(`ffmpeg exited with code ${code}:\n${args.join(' ')}\n${stderr.slice(-4000)}`));
        });
    });
}

/** Run `ffmpeg -i <file> -f null -` and return the stderr stream dump. */
async function probe(file: string): Promise<string> {
    const {stderr} = await runFfmpeg([
        '-hide_banner', '-loglevel', 'info', '-nostats',
        '-i', file, '-f', 'null', '-',
    ]);
    return stderr;
}

// ─── Directly-written assets ───────────────────────────────────

interface Cue {start: string; end: string; text: string[]}

function srt(cues: Cue[]): string {
    return cues.map((c, i) =>
        `${i + 1}\n${c.start} --> ${c.end}\n${c.text.join('\n')}\n`,
    ).join('\n');
}

/** An ASS dialogue cue. Times are `H:MM:SS.cc` and text uses ASS override tags. */
interface AssCue {start: string; end: string; text: string}

function ass(cues: AssCue[]): string {
    const header = [
        '[Script Info]',
        'ScriptType: v4.00+',
        'Title: Styled English',
        'PlayResX: 1920',
        'PlayResY: 1080',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Italic',
        'Style: Default,Arial,48,&H00FFFFFF,0,0',
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Text',
    ];
    const events = cues.map((c) => `Dialogue: 0,${c.start},${c.end},Default,${c.text}`);
    return [...header, ...events, ''].join('\r\n');
}

function writeSubtitleAssets(): void {
    mkdirSync(SUBS_DIR, {recursive: true});
    const files: Record<string, string> = {
        'eng.srt': srt([
            {start: '00:00:01,000', end: '00:00:05,000', text: ['Welcome to How It\u2019s Made.']},
            {start: '00:00:06,500', end: '00:00:10,500', text: ['Today: a glass bottle factory.']},
            {start: '00:00:31,000', end: '00:00:35,000', text: ['Molten glass is molded at 550\u00B0C.']},
        ]),
        'eng-sdh.srt': srt([
            {start: '00:00:01,000', end: '00:00:05,000', text: ['[machine hum] Welcome to How It\u2019s Made.']},
            {start: '00:00:06,500', end: '00:00:10,500', text: ['Today: a glass bottle factory.']},
            {start: '00:00:31,000', end: '00:00:35,000', text: ['[glass clanks] Molten glass is molded at 550\u00B0C.']},
        ]),
        'eng-forced.srt': srt([
            {start: '00:00:03,000', end: '00:00:06,000', text: ['[sign: GLASS BOTTLE PLANT]']},
            {start: '00:00:40,000', end: '00:00:43,000', text: ['[sign: SHIFT CHANGE \u2248 3,000 BOTTLES/HR]']},
        ]),
        'es-ES.srt': srt([
            {start: '00:00:01,000', end: '00:00:05,000', text: ['Bienvenidos a How It\u2019s Made.']},
            {start: '00:00:06,500', end: '00:00:10,500', text: ['Hoy: una f\u00E1brica de botellas de vidrio.']},
        ]),
        'es-419.srt': srt([
            {start: '00:00:01,000', end: '00:00:05,000', text: ['Bienvenidos a How It\u2019s Made.']},
            {start: '00:00:06,500', end: '00:00:10,500', text: ['Hoy: una planta de botellas de vidrio.']},
        ]),
        'zh-Hans.srt': srt([
            {start: '00:00:01,000', end: '00:00:05,000', text: ['\u6B22\u8FCE\u6765\u5230\u300A\u5982\u679C\u8FD9\u6837\u4F5C\u300B\u3002']},
            {start: '00:00:06,500', end: '00:00:10,500', text: ['\u4ECA\u5929\uFF1A\u73BB\u7483\u74F6\u5DE5\u5382\u3002']},
        ]),
        'zh-Hant.srt': srt([
            {start: '00:00:01,000', end: '00:00:05,000', text: ['\u6B61\u8FCE\u4F86\u5230\u300A\u5982\u679C\u9019\u6A23\u4F5C\u300B\u3002']},
            {start: '00:00:06,500', end: '00:00:10,500', text: ['\u4ECA\u5929\uFF1A\u7407\u7483\u74F6\u5DE5\u5EE0\u3002']},
        ]),
        'en-UK.srt': srt([
            {start: '00:00:01,000', end: '00:00:05,000', text: ['Welcome to How It\u2019s Made.']},
            {start: '00:00:06,500', end: '00:00:10,500', text: ['Today: a glass bottle factory in the Midlands.']},
        ]),
        // Styled text subtitles — a second TEXT codec alongside SubRip. Matroska
        // stores ASS as S_TEXT/ASS, so the preview reports the ASS codec name.
        'en-styled.ass': ass([
            {start: '0:00:01.00', end: '0:00:05.00', text: 'Styled subtitle line.\\NSecond styled line.'},
            {start: '0:00:06.50', end: '0:00:10.50', text: '\\i1Italic styled dialogue.\\i0'},
        ]),
    };
    for (const [name, content] of Object.entries(files)) {
        writeFileSync(path.join(SUBS_DIR, name), content, 'utf8');
    }
}

function writeAttachmentAssets(): void {
    mkdirSync(ATTACH_DIR, {recursive: true});
    writeFileSync(
        path.join(ATTACH_DIR, 'notes.txt'),
        'Integration test text attachment (text/plain).\r\nAttached to exercise the Attachment track UI.\r\n',
        'utf8',
    );
    // The spec allows simple text files standing in for real font files.
    writeFileSync(
        path.join(ATTACH_DIR, 'font.ttf'),
        'Integration test attachment standing in for a TTF font file.\r\n',
        'utf8',
    );
}

function writeChaptersAsset(): void {
    const chapters = [
        ';FFMETADATA1',
        'title=How It\u2019s Made',
        '[CHAPTER]', 'TIMEBASE=1/1000', 'START=0', 'END=15000', 'title=Introduction',
        '[CHAPTER]', 'TIMEBASE=1/1000', 'START=15000', 'END=30000', 'title=Raw Materials',
        '[CHAPTER]', 'TIMEBASE=1/1000', 'START=30000', 'END=45000', 'title=Assembly Line',
        '[CHAPTER]', 'TIMEBASE=1/1000', 'START=45000', 'END=60000', 'title=Quality Check',
        '',
    ].join('\n');
    writeFileSync(path.join(BASE_DIR, 'chapters.ffmeta'), chapters, 'utf8');
}

// ─── Expensive one-time encodes ────────────────────────────────

async function generateBaseStreams(): Promise<void> {
    console.log('[corpus] encoding base video streams (one-time)…');
    await runFfmpeg([
        '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24:duration=60',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p',
        path.join(BASE_DIR, 'video-avc.mkv'),
    ]);
    await runFfmpeg([
        '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24:duration=60',
        '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '38', '-pix_fmt', 'yuv420p',
        '-tag:v', 'hvc1',
        path.join(BASE_DIR, 'video-hevc.mkv'),
    ]);

    console.log('[corpus] encoding base audio streams (one-time)…');
    // Stereo FLAC — two distinct sine tones so L/R are distinguishable.
    await runFfmpeg([
        '-y', '-f', 'lavfi', '-i',
        'aevalsrc=0.2*sin(440*2*PI*t)|0.2*sin(554*2*PI*t):s=48000:d=60',
        '-c:a', 'flac', path.join(BASE_DIR, BASE_AUDIO_FILES.flac),
    ]);
    // AAC stereo derived from the FLAC (single transcode).
    await runFfmpeg([
        '-y', '-i', path.join(BASE_DIR, BASE_AUDIO_FILES.flac),
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        path.join(BASE_DIR, BASE_AUDIO_FILES.aacstereo),
    ]);
    // AAC 5.1 — makes the Preprocess "Downmix: Stereo" screenshot meaningful.
    await runFfmpeg([
        '-y', '-f', 'lavfi', '-i',
        'aevalsrc=0.2*sin(220*2*PI*t)|0.2*sin(220*2*PI*t)|0.3*sin(440*2*PI*t)|0.1*sin(330*2*PI*t)|0.1*sin(554*2*PI*t)|0.1*sin(660*2*PI*t):s=48000:d=60:c=5.1',
        '-c:a', 'aac', '-b:a', '192k',
        path.join(BASE_DIR, BASE_AUDIO_FILES.aac51),
    ]);
    // Commentary — distinct mono tone.
    await runFfmpeg([
        '-y', '-f', 'lavfi', '-i', 'aevalsrc=0.1*sin(330*2*PI*t):s=48000:d=60',
        '-c:a', 'aac', '-b:a', '96k', '-ac', '1',
        path.join(BASE_DIR, BASE_AUDIO_FILES.commentary),
    ]);
    console.log('[corpus] base streams ready.');
}

// ─── Episode assembly (remux only) ─────────────────────────────

async function assembleEpisode(spec: EpisodeSpec): Promise<void> {
    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    const videoBase = path.join(BASE_DIR, `video-${spec.video}.mkv`);
    args.push('-i', videoBase); // input 0

    const audioIdx = spec.audio.map((key, i) => {
        args.push('-i', path.join(BASE_DIR, BASE_AUDIO_FILES[key]));
        return i + 1;
    });
    let next = 1 + spec.audio.length;
    const subIdx: number[] = [];
    for (const sub of spec.subs) {
        args.push('-i', path.join(SUBS_DIR, `${sub.key}.${sub.format === 'ass' ? 'ass' : 'srt'}`));
        subIdx.push(next++);
    }
    if (spec.chapters) {
        args.push('-i', path.join(BASE_DIR, 'chapters.ffmeta'));
        next++;
    }
    const chaptersIdx = spec.chapters ? next - 1 : -1;

    args.push('-map', '0:v:0');
    for (const i of audioIdx) args.push('-map', `${i}:a:0`);
    for (const i of subIdx) args.push('-map', `${i}:s:0`);
    if (spec.chapters) {
        args.push('-map_metadata', String(chaptersIdx), '-map_chapters', String(chaptersIdx));
    }
    args.push('-c', 'copy');
    args.push('-metadata', `title=${spec.title}`);

    // Container + video. Language 'eng' keeps the video matched by the
    // `language equal eng` filter from the filter-language screenshot.
    args.push('-metadata:s:v:0', 'language=eng');

    for (const [i, key] of spec.audio.entries()) {
        args.push(`-metadata:s:a:${i}`, 'language=eng');
        if (key === 'commentary') {
            args.push(`-metadata:s:a:${i}`, 'title=Commentary', `-disposition:a:${i}`, 'comment');
        } else if (key === 'aac51') {
            args.push(`-metadata:s:a:${i}`, 'title=5.1 Surround', `-disposition:a:${i}`, i === 0 ? 'default' : '0');
        } else if (i === 0) {
            args.push(`-disposition:a:${i}`, 'default');
        } else {
            args.push(`-disposition:a:${i}`, '0');
        }
    }

    for (const [i, sub] of spec.subs.entries()) {
        args.push(`-metadata:s:s:${i}`, `language=${sub.lang}`);
        if (sub.title) args.push(`-metadata:s:s:${i}`, `title=${sub.title}`);
        args.push(`-disposition:s:${i}`, sub.disposition ?? '0');
    }

    for (const [i, name] of spec.attachments.entries()) {
        args.push('-attach', path.join(ATTACH_DIR, name));
        const isFont = name.endsWith('.ttf');
        args.push(
            `-metadata:s:t:${i}`, `mimetype=${isFont ? 'application/x-truetype-font' : 'text/plain'}`,
            `-metadata:s:t:${i}`, `filename=${name}`,
        );
    }

    mkdirSync(spec.dir, {recursive: true});
    args.push(path.join(spec.dir, spec.file));
    await runFfmpeg(args);
}

// ─── Verification (no ffprobe — parse `ffmpeg -i` stream dump) ─

interface StreamLine {
    index: number;
    type: string;
    codec: string;
    language?: string;
    /** Lowercased remainder of the stream line (dispositions appear here). */
    line: string;
    /** Lowercased per-stream metadata (title=…) following the line. */
    meta: string;
}

function parseStreams(dump: string): StreamLine[] {
    const streams: StreamLine[] = [];
    const lines = dump.split(/\r?\n/);
    const streamRe = /^\s*Stream #0:(\d+)(?:\(([^)]*)\))?:\s*(Video|Audio|Subtitle|Attachment|Data):\s*(\S+)/;
    let current: StreamLine | undefined;
    let inMeta = false;
    for (const raw of lines) {
        // Only the INPUT section describes the file itself — everything from
        // "Stream mapping:"/"Output #0" onward re-lists encoded output streams
        // in the same "Stream #0:N" numbering and would double-count them.
        if (/^(?:Stream mapping:|Output #)/.test(raw)) break;
        const m = raw.match(streamRe);
        if (m) {
            current = {
                index: Number(m[1]), language: m[2],
                type: m[3]!.toLowerCase(), codec: m[4]!.toLowerCase(),
                line: raw.toLowerCase(), meta: '',
            };
            streams.push(current);
            inMeta = false;
            continue;
        }
        if (current) {
            if (/^\s{2,}Metadata:\s*$/.test(raw)) { inMeta = true; continue; }
            if (inMeta && /^\s{4,}\S/.test(raw)) { current.meta += ` ${raw.trim().toLowerCase()}`; continue; }
            inMeta = false;
        }
    }
    return streams;
}

function verifyEpisode(spec: EpisodeSpec): void {
    const file = path.join(spec.dir, spec.file);
    const dump = probeSyncDumpCache.get(file);
    if (!dump) throw new Error(`[corpus] no probe dump for ${file}`);
    const streams = parseStreams(dump);
    const problems: string[] = [];

    const videos = streams.filter((s) => s.type === 'video');
    const audios = streams.filter((s) => s.type === 'audio');
    const subs = streams.filter((s) => s.type === 'subtitle');
    const attachments = streams.filter((s) => s.type === 'attachment');

    const expectVideoCodec = spec.video === 'avc' ? 'h264' : 'hevc';
    if (videos.length !== 1) problems.push(`expected 1 video, got ${videos.length}`);
    else if (!videos[0]!.codec.includes(expectVideoCodec)) problems.push(`video codec ${videos[0]!.codec} != ${expectVideoCodec}`);

    if (audios.length !== spec.audio.length) problems.push(`expected ${spec.audio.length} audio, got ${audios.length}`);
    for (const [i, key] of spec.audio.entries()) {
        const expected = key === 'flac' ? 'flac' : 'aac';
        const a = audios[i];
        if (a && !a.codec.includes(expected)) problems.push(`audio ${i} codec ${a.codec} != ${expected}`);
        if (a && key === 'aac51' && !/5\.1|48000 Hz, .*5\.1|fltp, .*5\.1/.test(a.line) && !a.line.includes('5.1')) problems.push(`audio ${i} is not 5.1: ${a.line.trim()}`);
        if (key === 'commentary' && a && !(a.line.includes('comment') || a.meta.includes('commentary'))) problems.push(`audio ${i} missing commentary disposition/title`);
        if (i === 0 && a && !a.line.includes('default')) problems.push(`audio 0 missing default disposition`);
    }

    if (subs.length !== spec.subs.length) problems.push(`expected ${spec.subs.length} subs, got ${subs.length}`);
    for (const [i, sub] of spec.subs.entries()) {
        const s = subs[i];
        if (!s) continue;
        const accepted = [sub.lang.toLowerCase(), ...(sub.langAlternates?.map((a) => a.toLowerCase()) ?? [])];
        if (s.language && !accepted.includes(s.language.toLowerCase())) {
            problems.push(`sub ${i} language '${s.language}' not in [${accepted.join(', ')}]`);
        }
        if (sub.title && !s.meta.includes(sub.title.toLowerCase())) problems.push(`sub ${i} missing title '${sub.title}' (meta:${s.meta.trim()})`);
        if (sub.expectCodec && !s.codec.includes(sub.expectCodec)) {
            problems.push(`sub ${i} codec '${s.codec}' != expected '${sub.expectCodec}'`);
        }
        // ffmpeg's dump renders dispositions human-readable:
        // "hearing_impaired" → "(hearing impaired)".
        if (sub.disposition && sub.disposition !== '0'
            && !s.line.includes(sub.disposition)
            && !s.line.includes(sub.disposition.replace(/_/g, ' '))) {
            problems.push(`sub ${i} missing disposition '${sub.disposition}': ${s.line.trim()}`);
        }
    }

    if (attachments.length !== spec.attachments.length) problems.push(`expected ${spec.attachments.length} attachments, got ${attachments.length}`);
    for (const name of spec.attachments) {
        if (!streams.some((s) => s.type === 'attachment' && dump.toLowerCase().includes(name.toLowerCase()))) {
            problems.push(`attachment ${name} not found`);
        }
    }

    if (spec.chapters && !dump.toLowerCase().includes('title=quality check') && !dump.includes('Chapter')) {
        // ffmpeg lists chapters as "Chapter #" blocks in the dump.
        if (!/Chapter #0/i.test(dump)) problems.push('chapters missing');
    }

    if (problems.length > 0) {
        throw new Error(`[corpus] verification failed for ${spec.file}:\n  - ${problems.join('\n  - ')}`);
    }
}

/** Probe dumps are collected once per file and reused by verifyEpisode. */
const probeSyncDumpCache = new Map<string, string>();

async function verifyCorpus(): Promise<void> {
    probeSyncDumpCache.clear();
    for (const spec of EPISODES) {
        const file = path.join(spec.dir, spec.file);
        probeSyncDumpCache.set(file, await probe(file));
    }
    for (const spec of EPISODES) verifyEpisode(spec);
    console.log(`[corpus] verified ${EPISODES.length} episodes.`);
}

// ─── Entry ──────────────────────────────────────────────────────

function stampCurrent(): boolean {
    try {
        return readFileSync(STAMP_PATH, 'utf8').trim() === STAMP_VERSION;
    } catch {
        return false;
    }
}

async function ensureBase(): Promise<void> {
    const baseFiles = [
        path.join(BASE_DIR, 'video-avc.mkv'),
        path.join(BASE_DIR, 'video-hevc.mkv'),
        ...Object.values(BASE_AUDIO_FILES).map((f) => path.join(BASE_DIR, f)),
    ];
    if (baseFiles.some((f) => !existsSync(f))) {
        await generateBaseStreams();
    }
}

/**
 * Generate the corpus lazily. Cheap when everything exists (only verification
 * runs); rebuilds base encodes only when the stamp is missing/outdated or
 * `force` is set.
 */
export async function generateCorpus(options?: {force?: boolean}): Promise<void> {
    const force = options?.force ?? process.env.MUXBOX_CORPUS_FORCE === '1';

    if (force || !stampCurrent()) {
        console.log('[corpus] stamp missing or outdated — rebuilding from scratch.');
        rmSync(CORPUS_ROOT, {recursive: true, force: true});
    }

    mkdirSync(VIDEO_DIR, {recursive: true});
    mkdirSync(SPECIALS_DIR, {recursive: true});
    mkdirSync(BASE_DIR, {recursive: true});

    // Cheap, always refreshed (text assets).
    writeSubtitleAssets();
    writeAttachmentAssets();
    writeChaptersAsset();

    await ensureBase();

    for (const spec of EPISODES) {
        const outFile = path.join(spec.dir, spec.file);
        if (force || !existsSync(outFile)) {
            console.log(`[corpus] remuxing ${spec.file}…`);
            await assembleEpisode(spec);
        }
    }

    await verifyCorpus();
    writeFileSync(STAMP_PATH, STAMP_VERSION, 'utf8');
    console.log(`[corpus] ready at ${CORPUS_ROOT}`);
}
