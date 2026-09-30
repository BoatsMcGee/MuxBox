import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { Multiplexer } from '@app/muxer';

type ThemeMode = 'light' | 'dark' | 'auto';

interface AppSettings {
    tmdbAccessToken: string;
    theme: ThemeMode;
    windowWidth?: number;
    windowHeight?: number;
    windowX?: number | null;
    windowY?: number | null;
    windowIsMaximized?: boolean;
    /** Global multiplexer method (Native or FFmpeg). */
    multiplexerMethod?: Multiplexer;
    /** Maximum number of concurrent muxing operations. Defaults to CPU cores - 1. */
    muxingConcurrency?: number;
}

const DEFAULT_SETTINGS: AppSettings = {
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

let _userDataPath: string | null = null;

function getUserDataPath(): string {
    if (!_userDataPath) {
        _userDataPath = app.getPath('userData');
    }
    return _userDataPath;
}

export async function getSettings(): Promise<AppSettings> {
    const userDataPath = getUserDataPath();
    const settingsPath = join(userDataPath, 'settings.json');
    try {
        const raw = readFileSync(settingsPath, 'utf-8');
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as AppSettings;
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    const current = await getSettings();
    const updated: AppSettings = { ...current, ...settings };
    const userDataPath = getUserDataPath();
    const settingsPath = join(userDataPath, 'settings.json');
    mkdirSync(userDataPath, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(updated, null, 2));
    return updated;
}