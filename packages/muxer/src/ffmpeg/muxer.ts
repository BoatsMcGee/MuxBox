import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'node:child_process';
import { type AVDisposition, type Demuxer, Muxer, type Stream } from 'node-av';
import { ffmpegPath } from 'node-av/ffmpeg';
import {
    type Episode,
} from '../episode/types.js';
import {
    type ProcessedVideoStream,
    type ProcessedAudioStream,
    type ProcessedSubtitleStream,
    type ProcessedStream,
} from '../selector/index.js';
import { type DispositionState, getDispositionFFmpegName } from './dispositions.js';

type PreprocessedVideoStream = ProcessedVideoStream & { filePath: string; };
type PreprocessedAudioStream = ProcessedAudioStream & { filePath: string; };
type PreprocessedSubtitleStream = ProcessedSubtitleStream & { filePath: string; };
type PreprocessedAttachmentStream = ProcessedStream & { filePath: string; };

interface StreamEntry {
    stream: Stream;
    demuxerMapKey: string;
    originalIndex: number;
    modify?: {
        language?: string;
        title?: string;
        disposition?: DispositionState;
        tags?: Record<string, string | undefined>;
        delay?: number;
    };
}

function isPreprocessed(demuxerMapKey: string): boolean {
    return demuxerMapKey.includes(':preprocess:');
}

function streamUniqueKey(demuxerMapKey: string, originalIndex: number): string {
    return `${demuxerMapKey}:${originalIndex}`;
}

async function writePreprocessedIntermediate(
    stream: Stream,
    demuxer: Demuxer,
    streamIndex: number,
    tempDir: string,
    typePrefix: string,
    index: number,
): Promise<string> {
    const intermediatePath = path.join(tempDir, `preprocess_${typePrefix}_${index}.mkv`);
    const muxer = await Muxer.open(intermediatePath);
    try {
        const outputIndex = muxer.addStream(stream);
        for await (const packet of demuxer.packets()) {
            if (!packet) continue;
            if (packet.streamIndex === streamIndex) {
                await muxer.writePacket(packet, outputIndex);
            } else {
                packet.free();
            }
        }
    } finally {
        await muxer.close();
    }
    return intermediatePath;
}

export async function muxWithFFmpeg(
    episode: Episode,
    videoStreams: PreprocessedVideoStream[],
    audioStreams: PreprocessedAudioStream[],
    subtitleStreams: PreprocessedSubtitleStream[],
    attachmentStreams: PreprocessedAttachmentStream[],
    demuxerMap: Map<string, Demuxer>,
    tempDir: string,
    fileName: string,
): Promise<string | undefined> {
    fs.mkdirSync(tempDir, { recursive: true });

    const intermediateFiles: string[] = [];

    try {
        // Step 1: Write preprocessed intermediates
        let preprocessIndex = 0;
        const preprocessedIntermediates = new Map<string, string>();

        const allStreams: StreamEntry[] = [
            ...videoStreams,
            ...audioStreams,
            ...subtitleStreams,
            ...attachmentStreams,
        ];

        for (const entry of allStreams) {
            if (!isPreprocessed(entry.demuxerMapKey)) continue;
            if (preprocessedIntermediates.has(entry.demuxerMapKey)) continue;

            for (const [key, demuxer] of demuxerMap) {
                if (key === entry.demuxerMapKey) {
                    const intermediatePath = await writePreprocessedIntermediate(
                        entry.stream,
                        demuxer,
                        0,
                        tempDir,
                        'stream',
                        preprocessIndex++,
                    );
                    intermediateFiles.push(intermediatePath);
                    preprocessedIntermediates.set(entry.demuxerMapKey, intermediatePath);
                    break;
                }
            }
        }

        // Step 2: Build FFmpeg command
        const ffmpeg = ffmpegPath();
        const outputPath = path.resolve(episode.file.directory, `${fileName}.mkv`);
        const args: string[] = ['-y'];

        // Track which input index each stream maps to
        const streamInputMap = new Map<string, { inputIndex: number; streamIndex: number }>();

        // Group source streams by (sourcePath, delay)
        const sourceInputGroups = new Map<string, { sourcePath: string; delay: number; streams: { uniqueKey: string; originalIndex: number }[] }>();

        for (const entry of allStreams) {
            if (isPreprocessed(entry.demuxerMapKey)) continue;

            const delay = (entry.modify?.delay ?? 0) / 1000;
            const sourcePath = entry.demuxerMapKey;
            const groupKey = `${sourcePath}|${delay}`;
            const uniqueKey = streamUniqueKey(entry.demuxerMapKey, entry.originalIndex);

            if (!sourceInputGroups.has(groupKey)) {
                sourceInputGroups.set(groupKey, { sourcePath, delay, streams: [] });
            }
            sourceInputGroups.get(groupKey)!.streams.push({
                uniqueKey,
                originalIndex: entry.originalIndex,
            });
        }

        let currentInputIndex = 0;

        // Add source inputs
        for (const { sourcePath, delay, streams } of sourceInputGroups.values()) {
            if (delay !== 0) {
                args.push('-itsoffset', String(delay));
            }
            args.push('-i', sourcePath);

            for (const streamInfo of streams) {
                streamInputMap.set(streamInfo.uniqueKey, {
                    inputIndex: currentInputIndex,
                    streamIndex: streamInfo.originalIndex,
                });
            }
            currentInputIndex++;
        }

        // Add preprocessed intermediate inputs
        for (const [demuxerMapKey, intermediatePath] of preprocessedIntermediates) {
            const entries = allStreams.filter(s => s.demuxerMapKey === demuxerMapKey);
            const delayGroups = new Map<number, StreamEntry[]>();
            for (const entry of entries) {
                const delay = (entry.modify?.delay ?? 0) / 1000;
                if (!delayGroups.has(delay)) {
                    delayGroups.set(delay, []);
                }
                delayGroups.get(delay)!.push(entry);
            }

            for (const [delay, groupEntries] of delayGroups) {
                if (delay !== 0) {
                    args.push('-itsoffset', String(delay));
                }
                args.push('-i', intermediatePath);

                for (const entry of groupEntries) {
                    const uniqueKey = streamUniqueKey(entry.demuxerMapKey, entry.originalIndex);
                    streamInputMap.set(uniqueKey, {
                        inputIndex: currentInputIndex,
                        streamIndex: 0,
                    });
                }
                currentInputIndex++;
            }
        }

        // Step 3: Map streams in sorted order
        const orderedStreams = [...videoStreams, ...audioStreams, ...subtitleStreams, ...attachmentStreams];

        let outputIndex = 0;
        const streamOutputIndices = new Map<string, number>();

        for (const entry of orderedStreams) {
            const uniqueKey = streamUniqueKey(entry.demuxerMapKey, entry.originalIndex);
            const mapping = streamInputMap.get(uniqueKey);
            if (!mapping) continue;

            args.push('-map', `${mapping.inputIndex}:${mapping.streamIndex}`);
            streamOutputIndices.set(uniqueKey, outputIndex);
            outputIndex++;
        }

        // Step 4: Per-stream metadata
        for (const entry of orderedStreams) {
            const uniqueKey = streamUniqueKey(entry.demuxerMapKey, entry.originalIndex);
            const outIdx = streamOutputIndices.get(uniqueKey);
            if (outIdx === undefined) continue;

            const modify = entry.modify;
            if (!modify) continue;

            if (modify.language) {
                args.push(`-metadata:s:${outIdx}`, `language=${modify.language}`);
            }
            if (modify.title) {
                args.push(`-metadata:s:${outIdx}`, `title=${modify.title}`);
            }
            if (modify.tags) {
                for (const [key, value] of Object.entries(modify.tags)) {
                    if (value !== undefined) {
                        args.push(`-metadata:s:${outIdx}`, `${key}=${value}`);
                    }
                }
            }
            if (modify.disposition) {
                const parts: string[] = [];
                for (const [disposition, value] of Object.entries(modify.disposition)) {
                    const ffmpegName = getDispositionFFmpegName(Number(disposition) as AVDisposition);
                    if (ffmpegName) {
                        const prefix = value ? '+' : '-';
                        parts.push(`${prefix}${ffmpegName}`);
                    }
                }
                if (parts.length > 0) {
                    args.push(`-disposition:s:${outIdx}`, parts.join(''));
                }
            }
        }

        // Step 5: Global metadata
        const title = episode.series.episode.name ?? episode.series.name;
        args.push('-metadata', `title=${title}`);

        if (episode.modifyTags) {
            for (const [key, value] of Object.entries(episode.modifyTags)) {
                if (value !== undefined) {
                    args.push('-metadata', `${key}=${value}`);
                }
            }
        }

        // Step 6: Output
        args.push('-map_chapters', '-1');
        args.push('-c', 'copy');
        args.push(outputPath);

        // Step 7: Execute FFmpeg
        await new Promise<void>((resolve, reject) => {
            const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });

            let stderr = '';
            proc.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg failed with exit code ${code}: ${stderr}`));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
            });
        });

        return fileName;
    } finally {
        for (const filePath of intermediateFiles) {
            try {
                fs.rmSync(filePath);
            } catch {
                // Ignore cleanup errors
            }
        }
    }
}
