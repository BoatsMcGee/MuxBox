/**
 * Screenshot capture: every UI state is captured twice — light then dark —
 * as PNG into `media/screenshots-temporary/{light,dark}/<name>.png`.
 * global-teardown encodes them to 1920x1080 AVIF and moves them into
 * `media/screenshots` when the whole suite passes.
 *
 * The theme is toggled by flipping the `.dark` class on <html>, which is
 * exactly what the app's `applyTheme()` does (settings seed theme='light').
 * Hover/modal states are unaffected by the class flip, so one interaction
 * yields both theme variants.
 */
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type {Page} from '@playwright/test';

const SCREENSHOTS_TEMP_DIR = path.join(process.cwd(), 'media', 'screenshots-temporary');

export type Theme = 'light' | 'dark';

async function setTheme(page: Page, theme: Theme): Promise<void> {
    await page.evaluate((t) => {
        document.documentElement.classList.toggle('dark', t === 'dark');
    }, theme);
}

async function settle(page: Page): Promise<void> {
    await page.evaluate(() => document.fonts.ready);
    // One frame for layout after the theme flip.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await page.waitForTimeout(120);
}

/**
 * Capture the current viewport as `light/<name>.png` and `dark/<name>.png`.
 * `name` mirrors the spec paths, e.g. 'project/main' or 'homepage'.
 */
export async function capture(page: Page, name: string): Promise<void> {
    const rel = name.replace(/^\/+/, '').replace(/\/+$/, '');

    // Never write a narrow PNG: a docked DevTools pane (or an unsized window)
    // would silently get stretched to 1920x1080 during encoding. Use the real
    // page viewport — page.viewportSize() is null in Electron.
    const size = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
    }));
    if (size.width !== 1920 || size.height !== 1080) {
        throw new Error(
            `Unexpected viewport ${size.width}x${size.height} for '${rel}' — expected 1920x1080 (DevTools open?)`,
        );
    }

    await settle(page);

    await setTheme(page, 'light');
    await settle(page);
    const lightPath = path.join(SCREENSHOTS_TEMP_DIR, 'light', `${rel}.png`);
    mkdirSync(path.dirname(lightPath), {recursive: true}); // nested (e.g. project/)
    await page.screenshot({path: lightPath, animations: 'disabled'});

    await setTheme(page, 'dark');
    await settle(page);
    const darkPath = path.join(SCREENSHOTS_TEMP_DIR, 'dark', `${rel}.png`);
    mkdirSync(path.dirname(darkPath), {recursive: true});
    await page.screenshot({path: darkPath, animations: 'disabled'});
}
