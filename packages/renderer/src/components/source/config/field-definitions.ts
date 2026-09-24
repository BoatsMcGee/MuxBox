import type { FieldDef } from '@/components/source/types/stream-match-types';
import type { StreamType } from '@/components/source/types/stream-match-constants';

// ─── Field definitions per stream type ──────────────────────────

const videoFields: FieldDef[] = [
    { value: 'index', label: 'Index', type: 'number' },
    { value: 'codec', label: 'Codec', type: 'number' },
    { value: 'title', label: 'Title', type: 'string' },
    { value: 'language', label: 'Language', type: 'string' },
    { value: 'disposition', label: 'Disposition', type: 'string' },
    { value: 'size', label: 'Size', type: 'number' },
    { value: 'duration', label: 'Duration', type: 'number' },
    { value: 'width', label: 'Width', type: 'number' },
    { value: 'height', label: 'Height', type: 'number' },
    { value: 'bitrate', label: 'Bitrate', type: 'number' },
];

const audioFields: FieldDef[] = [
    { value: 'index', label: 'Index', type: 'number' },
    { value: 'codec', label: 'Codec', type: 'number' },
    { value: 'title', label: 'Title', type: 'string' },
    { value: 'language', label: 'Language', type: 'string' },
    { value: 'disposition', label: 'Disposition', type: 'string' },
    { value: 'size', label: 'Size', type: 'number' },
    { value: 'duration', label: 'Duration', type: 'number' },
    { value: 'channels', label: 'Channels', type: 'number' },
    { value: 'bitrate', label: 'Bitrate', type: 'number' },
];

const subtitleFields: FieldDef[] = [
    { value: 'index', label: 'Index', type: 'number' },
    { value: 'codec', label: 'Codec', type: 'number' },
    { value: 'title', label: 'Title', type: 'string' },
    { value: 'language', label: 'Language', type: 'string' },
    { value: 'disposition', label: 'Disposition', type: 'string' },
    { value: 'size', label: 'Size', type: 'number' },
    { value: 'duration', label: 'Duration', type: 'number' },
];

const attachmentFields: FieldDef[] = [
    { value: 'codec', label: 'Codec', type: 'number' },
    { value: 'fileName', label: 'File Name', type: 'string' },
    { value: 'mimeType', label: 'MIME Type', type: 'string' },
];

/** Get the field definitions for a given stream type. */
export function getFieldDefs(streamType: StreamType): FieldDef[] {
    switch (streamType) {
        case 'video': return videoFields;
        case 'audio': return audioFields;
        case 'subtitle': return subtitleFields;
        case 'attachment': return attachmentFields;
        default: return videoFields;
    }
}
