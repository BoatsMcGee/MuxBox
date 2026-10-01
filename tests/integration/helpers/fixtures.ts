/**
 * Shared Playwright fixtures for the MuxBox integration suite.
 *
 * - Worker-scoped Electron app launched with MUXBOX_USER_DATA pointed at
 *   `tests/integration/appdata` (see packages/entry-point.mjs) and
 *   PLAYWRIGHT_TEST=true for the crash handlers.
 * - Window content area forced to exactly 1920x1080 for screenshots.
 * - Directory picker IPC stubbed so `Browse` returns corpus paths without a
 *   native dialog.
 */
import {existsSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {test as base, expect, _electron as electron} from '@playwright/test';
import type {ElectronApplication, Page} from '@playwright/test';
import {globSync} from 'glob';
import {APPDATA_DIR} from '../seed-data';

export {expect};

export const REPO_ROOT = process.cwd();
export const VIDEO_DIR = path.join(REPO_ROOT, 'tests', 'integration', 'corpus', 'Video');
export const SPECIALS_DIR = path.join(REPO_ROOT, 'tests', 'integration', 'corpus', 'Specials');

/** Screenshot viewport (content size, excluding window chrome). */
export const SCREENSHOT_WIDTH = 1920;
export const SCREENSHOT_HEIGHT = 1080;

/**
 * Force the window to exactly 1920x1080 *content* and make sure the renderer
 * actually adopts it.
 *
 * A docked DevTools pane splits the window: native `getContentSize()` still
 * reports the full 1920 while `window.innerWidth` collapses by the pane width
 * (measured: 555px). Screenshots are taken from `window.innerWidth` (see
 * capture()), so such a run silently produces narrow images that are then
 * stretched during encoding.
 *
 * The pane opens on its own about a second after the page loads, and again
 * after every page.reload(). `isDevToolsOpened()` is false at t=0 and true by
 * t=1s, so a single check races it and loses. This resizes, closes, and then
 * VERIFIES the width the renderer reports, retrying until it matches.
 */
export async function setScreenshotViewport(app: ElectronApplication, page: Page): Promise<void> {
    let last = {width: 0, height: 0};

    for (let attempt = 1; attempt <= 6; attempt++) {
        await app.evaluate(({BrowserWindow}, size) => {
            const win = BrowserWindow.getAllWindows()[0];
            if (!win) return;
            win.setContentSize(size.width, size.height);
            if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
        }, {width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT});

        // The renderer applies the resize asynchronously; give it a beat, then
        // trust the DOM over the native call.
        await page.waitForTimeout(500);
        last = await page.evaluate(() => ({width: window.innerWidth, height: window.innerHeight}));
        if (last.width === SCREENSHOT_WIDTH && last.height === SCREENSHOT_HEIGHT) {
            // Correct once is not enough: the pane can still open a moment
            // later and steal the width back. Require it to hold.
            await page.waitForTimeout(750);
            const after = await page.evaluate(() => ({
                width: window.innerWidth,
                height: window.innerHeight,
            }));
            if (after.width === SCREENSHOT_WIDTH && after.height === SCREENSHOT_HEIGHT) return;
            last = after;
        }
    }

    throw new Error(
        `Could not reach a ${SCREENSHOT_WIDTH}x${SCREENSHOT_HEIGHT} renderer viewport `
        + `(got ${last.width}x${last.height}). A docked DevTools pane steals page width — `
        + 'check that it is closed.',
    );
}

/** CSS injected into the page: kill animations/transitions and the text caret
 *  so screenshots are deterministic. Re-applied after page.reload(). */
const DETERMINISM_CSS = `
*, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
}
`;

function findExecutable(): string {
    // productName is MuxBox; lowercase variants keep stale pre-rename dists findable.
    const candidates = [
        'dist/win-unpacked/MuxBox.exe',
        'dist/win-unpacked/muxbox.exe',
        'dist/win-arm64-unpacked/MuxBox.exe',
        'dist/win-arm64-unpacked/muxbox.exe',
        'dist/linux-unpacked/MuxBox',
        'dist/linux-unpacked/muxbox',
        'dist/mac/MuxBox.app/Contents/MacOS/*',
        'dist/mac-arm64/MuxBox.app/Contents/MacOS/*',
        'dist/mac/*/Contents/MacOS/*',
    ];
    for (const candidate of candidates) {
        const [match] = globSync(candidate);
        if (match && existsSync(match)) return match;
    }
    throw new Error(
        'App executable not found under dist/. Run `npm run compile` before the integration tests.',
    );
}

type Fixtures = {
    app: ElectronApplication;
    page: Page;
};

export const test = base.extend<Fixtures>({
    // Test-scoped (fresh Electron per test): Playwright types worker-scoped
    // fixtures through extend's second type parameter, which the specs don't
    // need — launching per test also keeps IPC dialog stubs isolated.
    // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature requires destructured args
    app: async ({}, use) => {
        const electronApp = await electron.launch({
            executablePath: findExecutable(),
            // Pin the display scale. Chromium screenshots at the device pixel
            // ratio, so on a 150% display every capture comes out 2880x1620 and
            // teardown rejects it. Note `page.screenshot({scale:'css'})` does NOT
            // help here — Electron ignores it (measured: both produce 2880x1620),
            // and `clip` is unusable because viewportSize() is null in Electron.
            args: ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1'],
            env: {
                ...process.env,
                PLAYWRIGHT_TEST: 'true',
                MUXBOX_USER_DATA: APPDATA_DIR,
            },
        });

        electronApp.on('console', (msg) => {
            if (msg.type() === 'error') {
                console.error(`[electron][${msg.type()}] ${msg.text()}`);
            }
        });

        const page = await electronApp.firstWindow();
        page.on('pageerror', (error) => {
            if (error instanceof Error) {
                console.error('[pageerror]', error.stack ?? error.message);
                return;
            }
            // Electron sometimes delivers raw values here — print the runtime
            // kind so a repeat can identify the emitter instead of `[Event]`.
            console.error(`[pageerror] non-Error value: ${String(error)} (${typeof error})`);
        });
        await page.waitForLoadState('load');

        await setScreenshotViewport(electronApp, page);

        await injectDeterminismCss(page);

        await use(electronApp);
        await electronApp.close();
    },

    page: async ({app}, use) => {
        const page = await app.firstWindow();
        await use(page);
    },
});

/** (Re)inject determinism CSS — needed again after every page.reload(). */
export async function injectDeterminismCss(page: Page): Promise<void> {
    await page.evaluate((css) => {
        const id = 'muxbox-test-determinism';
        if (document.getElementById(id)) return;
        const style = document.createElement('style');
        style.id = id;
        style.textContent = css;
        document.head.appendChild(style);
    }, DETERMINISM_CSS);
}

/**
 * Stub the `dialog:openDirectory` IPC handler so the header `Browse` button
 * picks directories without a native dialog. Returns corpus paths instead.
 */
export async function stubDirectoryDialog(app: ElectronApplication, dir: string): Promise<void> {
    await app.evaluate(({ipcMain}, target: string) => {
        ipcMain.removeHandler('dialog:openDirectory');
        ipcMain.handle('dialog:openDirectory', async () => target);
    }, dir);
}
