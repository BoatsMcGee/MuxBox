import {initApp} from '@app/main';
import {app} from 'electron';
import {fileURLToPath} from 'node:url';

/**
 * Integration-test hook: redirect ALL app data (projects/, settings.json,
 * tmdb-cache/, presets/) to a custom root so tests never touch the real
 * installation. Must run before app.whenReady() — Electron locks the default
 * userData path once the app is ready.
 */
if (process.env.MUXBOX_USER_DATA) {
    app.setPath('userData', process.env.MUXBOX_USER_DATA);
}

if (process.env.NODE_ENV === 'development' || process.env.PLAYWRIGHT_TEST === 'true' || !!process.env.CI) {
    function showAndExit(...args) {
        console.error(...args);
        process.exit(1);
    }

    process.on('uncaughtException', showAndExit);
    process.on('unhandledRejection', showAndExit);
}

// noinspection JSIgnoredPromiseFromCall
/**
 * '@app/renderer' and '@app/preload' are resolved here rather than inside
 * '@app/main' so the main package stays free of renderer/preload build
 * dependencies and only receives their resolved locations at startup.
 */
initApp(
    {
        renderer: (process.env.MODE === 'development' && !!process.env.VITE_DEV_SERVER_URL) ?
            new URL(process.env.VITE_DEV_SERVER_URL)
            : {
                path: fileURLToPath(import.meta.resolve('@app/renderer')),
            },

        preload: {
            path: fileURLToPath(import.meta.resolve('@app/preload/exposed.mjs')),
        },
    },
);
