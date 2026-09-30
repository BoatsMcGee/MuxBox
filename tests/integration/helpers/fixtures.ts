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
            args: ['--no-sandbox', '--hide-scrollbars'],
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

        // A dev build auto-opens DevTools; a docked pane steals page width
        // (narrow screenshots that would stretch to 1920x1080). Close it
        // BEFORE setting the exact screenshot viewport.
        await electronApp.evaluate(({BrowserWindow}) => {
            const contents = BrowserWindow.getAllWindows()[0]?.webContents;
            if (contents?.isDevToolsOpened()) contents.closeDevTools();
        });
        await page.waitForTimeout(150);

        // Exact screenshot viewport (content size, excluding window chrome).
        await electronApp.evaluate(({BrowserWindow}) => {
            const win = BrowserWindow.getAllWindows()[0];
            if (win) win.setContentSize(1920, 1080);
        });

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
