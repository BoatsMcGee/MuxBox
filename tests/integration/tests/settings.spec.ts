/**
 * Settings screenshots.
 * Story: application preferences — theme selection, TMDB token, muxing knobs,
 * and the default rename template new projects start from.
 * The app seeds theme 'light'; screenshots flip the .dark class themselves.
 */
import {test, expect} from '../helpers/fixtures';
import {capture} from '../helpers/screenshot';
import {openSettings} from '../helpers/ui';

test.describe('Settings', () => {
    test('settings', async ({page}) => {
        await openSettings(page);
        await expect(page.getByRole('heading', {name: 'Theme'})).toBeVisible();
        await expect(page.getByRole('button', {name: 'Light'})).toBeVisible();
        await capture(page, 'settings');
    });

    test('default rename template seeds a new project', async ({page}) => {
        // Regression guard: the resolved field config is a Pinia computed value,
        // so it reaches project data as a reactive proxy. A proxy cannot cross
        // the IPC bridge, so saveProject threw "An object could not be cloned"
        // and the new project was never created — silently, since the click
        // handler swallows the rejection.
        const custom = 'CUSTOMTPL {{SERIES_NAME}} {{EPISODE_NAME}}';
        await openSettings(page);
        await expect(page.getByRole('heading', {name: 'Default Rename Template'})).toBeVisible();

        // Expand the shared rename editor, replace the template, apply, save.
        await page.getByRole('button', {name: 'Edit'}).click();
        const editor = page.locator('[contenteditable="plaintext-only"]');
        await editor.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.type(custom);
        await page.getByRole('button', {name: 'Apply'}).click();
        await page.getByRole('button', {name: 'Save Settings'}).click();
        await expect(page.getByText('Saved!')).toBeVisible();

        await page.getByRole('button', {name: '← Back'}).click();
        await page.getByRole('button', {name: 'New Project'}).click();

        // The project page must actually open — that is the assertion that
        // fails when project creation throws.
        const label = page.locator('label', {hasText: 'Rename Template'}).first();
        await expect(label).toBeVisible({timeout: 20_000});
        await expect(label.locator('xpath=../..')).toContainText(custom);
    });
});
