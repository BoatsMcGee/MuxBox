/**
 * Home (Landing) screenshots.
 * Story: "projects overview" — the app opens on the Projects card listing the
 * seeded showcase project plus an untouched default project.
 */
import {test, expect} from '../helpers/fixtures';
import {capture} from '../helpers/screenshot';
import {reloadApp} from '../helpers/ui';

test.describe('Home', () => {
    test('homepage', async ({page}) => {
        await reloadApp(page);
        await expect(page.getByRole('heading', {name: 'MuxBox'})).toBeVisible();
        await expect(page.getByRole('heading', {name: 'Projects'})).toBeVisible();
        // Seeded projects, sorted by lastOpened — "How" first.
        const rows = page.locator('div.divide-y > div');
        await expect(rows.filter({hasText: 'How'})).toHaveCount(1);
        await expect(rows.filter({hasText: 'New Project'})).toHaveCount(1);
        await capture(page, 'homepage');
    });
});
