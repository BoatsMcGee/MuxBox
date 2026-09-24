/**
 * Settings screenshots.
 * Story: application preferences — theme selection, TMDB token, muxing knobs.
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
});
