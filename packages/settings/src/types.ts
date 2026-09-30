import type { Multiplexer } from '@app/muxer';

export type ThemeMode = 'light' | 'dark' | 'auto';

export interface AppSettings {
    tmdbAccessToken: string;
    theme: ThemeMode;
    windowWidth?: number;
    windowHeight?: number;
    windowX?: number | null;
    windowY?: number | null;
    windowIsMaximized?: boolean;
    /** Global multiplexer method (Native or FFmpeg). Overrides per-project muxOptions.method. */
    multiplexerMethod?: Multiplexer;
    /** Maximum number of concurrent muxing operations. Defaults to CPU cores - 1. */
    muxingConcurrency?: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
    tmdbAccessToken: '',
    theme: 'auto',
    windowWidth: 1200,
    windowHeight: 800,
    windowX: undefined,
    windowY: undefined,
    windowIsMaximized: false,
    multiplexerMethod: { keepNegativePackets: false, clipTimestamps: false },
    muxingConcurrency: undefined,
};
