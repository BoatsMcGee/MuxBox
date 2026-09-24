// ─── Stream type ────────────────────────────────────────────────

export type StreamType = 'video' | 'audio' | 'subtitle' | 'attachment';

// ─── Stream item shape ──────────────────────────────────────────

export interface StreamItem {
    id: string;
    name?: string;
    match: Record<string, unknown>;
    modify?: Record<string, unknown>;
    preprocess?: Record<string, unknown>;
}

// ─── Default item names ─────────────────────────────────────────

export const DEFAULT_ITEM_NAMES: Record<StreamType, string> = {
    video: 'Video Configuration',
    audio: 'Audio Configuration',
    subtitle: 'Subtitle Configuration',
    attachment: 'Attachment Configuration',
};

// ─── Disposition option type ────────────────────────────────────

export interface DispositionOption {
    value: string;
    label: string;
}

// ─── TagEntry type ──────────────────────────────────────────────

export interface TagEntry {
    key: string;
    value: string;
}
