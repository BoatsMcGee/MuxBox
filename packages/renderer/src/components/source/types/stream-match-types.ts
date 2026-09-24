export interface FieldDef {
    value: string;
    label: string;
    type: 'string' | 'number';
}

export interface OperatorOption {
    value: string;
    label: string;
    appliesTo: string[];
}

export interface VisualRow {
    field: string;
    operator: string;
    value: string;
    patternFlags: string;
    subRows: VisualRow[];
}

// ─── Preview types (shared between Preview and SourceEditView) ──

import type { MatchedTrack } from '@/lib/stream-match';

export interface FilePreviewState {
    file: string;
    loading: boolean;
    error: boolean;
    totalStreams: number;
    matchedStreams: number;
    tracks: MatchedTrack[];
    anyMatched: boolean;
}

export interface FileEpisodeInfo {
    season: number;
    episode: number;
    episodeName?: string;
}
