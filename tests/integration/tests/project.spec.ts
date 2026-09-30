/**
 * Project page screenshots (16 shots).
 *
 * Every test reloads the app first (memory router resets to landing) and
 * opens the seeded "How" project (or "New Project" for the empty state).
 * Tests that mutate project state restore it and flush the 500ms autosave
 * before finishing, so later tests read a stable store from disk.
 */
import {test as appTest, expect as appExpect, stubDirectoryDialog} from '../helpers/fixtures';
import {capture} from '../helpers/screenshot';
import {
    expandQueueEpisode,
    expandQueueTrack,
    expectNoPageOverflow,
    expectNoPageScrollbar,
    flushProjectSave,
    hoverTooltip,
    openHowProject,
    openNewProject,
    openProject,
    queueItem,
    setQueueSection,
} from '../helpers/ui';

// Local aliases so the spec reads naturally (fixture-bound test/expect).
const t = appTest;
const expect = appExpect;

t.describe('Project', () => {
    t('project/main', async ({page}) => {
        await openHowProject(page);
        await capture(page, 'project/main');
    });

    t('project/empty', async ({page}) => {
        await openProject(page, 'New Project');
        // ProjectView keeps the queue panel hidden until a source exists — an
        // empty project shows only the settings column plus the Add Source card.
        const addSource = page.locator('div.border-2.border-dashed').filter({hasText: 'Add Source'});
        await expect(addSource.first()).toBeVisible();
        await capture(page, 'project/empty');
    });

    t('project/layout-no-scrollbar', async ({page}) => {
        // Regression guard: the page used to reserve height with a hand-tuned
        // `calc(100vh - 5rem)` grid inside an already-full-height parent, which
        // summed past the viewport and left a scrollbar on every page.
        await openNewProject(page);
        await expectNoPageOverflow(page);
        await expectNoPageScrollbar(page);

        // A populated project is taller but must still fit the viewport.
        await openHowProject(page);
        await expectNoPageOverflow(page);
        await expectNoPageScrollbar(page);
    });

    t('project/output-directory', async ({page, app}) => {
        await openHowProject(page);
        // The output field is readonly — editing goes through the native
        // Browse dialog, stubbed via IPC to a deterministic path.
        await stubDirectoryDialog(app, 'C:/Media/TV');
        await page.locator('button:text-is("Browse")').first().click();
        const output = page.locator('input[placeholder^="Output directory"]');
        await expect(output).toHaveValue('C:/Media/TV');
        await capture(page, 'project/output-directory');
        // Restore and flush the autosave before the next test reloads.
        await stubDirectoryDialog(app, 'C:/TV');
        await page.locator('button:text-is("Browse")').first().click();
        await expect(output).toHaveValue('C:/TV');
        await flushProjectSave(page);
    });

    t('project/undo-redo', async ({page}) => {
        await openHowProject(page);
        await page.locator('button:text-is("Edit Tags")').click();
        // The dashed "Add Tag" placeholder is a div with a click handler.
        await page.getByText('Add Tag', {exact: true}).click();
        const keyInputs = page.locator('input[placeholder="Key..."]');
        const valueInputs = page.locator('input[placeholder="Value..."]');
        await keyInputs.last().fill('show');
        await valueInputs.last().fill('MuxBox');
        await page.locator('button:text-is("Apply")').click();
        await expect(page.getByText('show')).toBeVisible();
        // History now holds the tag edit → undo reverts, redo re-applies.
        await page.locator('button:text-is("Undo")').click();
        await expect(page.getByText('show')).toHaveCount(0);
        await page.locator('button:text-is("Redo")').click();
        await expect(page.getByText('show')).toBeVisible();
        await capture(page, 'project/undo-redo');
        // Leave both tags in place (intentional state), flush before reload.
        await flushProjectSave(page);
    });

    t('project/seasons-browser', async ({page}) => {
        await openHowProject(page);
        await page.locator('button:text-is("Seasons")').click();
        // Season 1 expands by default; the renamed specials season is visible.
        const specialName = page.locator('input[placeholder="Specials"]');
        await expect(specialName).toHaveValue('Special Editions');
        // Real TMDB cache: the specials season holds 73 episodes (73 is unique
        // across seasons — every regular season has 13).
        await expect(page.getByText('73 episodes')).toBeVisible();
        await capture(page, 'project/seasons-browser');
        await page.getByRole('button', {name: 'Close'}).click();
        await expect(specialName).toBeHidden();
    });

    t('project/episode-name-modal', async ({page}) => {
        await openHowProject(page);
        await page.locator('button:text-is("Seasons")').click();
        // Expand Season 0 (click its episode count — the name span starts a
        // season-number rename instead).
        await page.getByText('73 episodes').click();
        // Real TMDB title for specials episode 2.
        const epRow = page.locator('div.border-b').filter({hasText: 'Shark Week Edition'}).first();
        // The pencil button carries a Reka tooltip, not a title attribute —
        // it's the row's only button in the default (non-overridden) state.
        await epRow.locator('button').first().click();
        // While editing (and after commit) the title renders as an input whose
        // value is NOT text — locate it page-wide, the row filter stops matching.
        const override = page.locator('input[placeholder="Override title..."]');
        await override.fill('Shark Week Edition (Extended)');
        await override.press('Enter');
        await expect(page.locator('input[placeholder="Override title..."]')).toHaveValue(
            'Shark Week Edition (Extended)',
        );
        await capture(page, 'project/episode-name-modal');
        await page.getByRole('button', {name: 'Close'}).click();
        // The name override is intentional (specials are not muxed in tests).
        await flushProjectSave(page);
    });

    t('project/rename-template-modal', async ({page}) => {
        await openHowProject(page);
        await page.locator('button:text-is("Edit")').click();
        // Edit mode: contenteditable template + example preview + field cards.
        await expect(page.locator('[contenteditable="plaintext-only"]')).toBeVisible();
        await expect(page.getByText('Example Preview')).toBeVisible();
        await capture(page, 'project/rename-template-modal');
        await page.locator('button:text-is("Cancel")').click();
        await expect(page.locator('[contenteditable="plaintext-only"]')).toBeHidden();
    });

    t('project/series-search', async ({page}) => {
        await openHowProject(page);
        const search = page.locator('input[placeholder="Search for a series on TMDB..."]');
        await search.click();
        await search.pressSequentially('How It');
        await capture(page, 'project/series-search');
        // Restore the exact series name (typing emits update:modelValue live).
        await search.press('Control+a');
        await search.pressSequentially("How It's Made");
        await expect(search).toHaveValue("How It's Made");
        await page.getByRole('heading', {name: 'Project Settings'}).click();
        await flushProjectSave(page);
    });

    t('project/sources', async ({page}) => {
        await openHowProject(page);
        await expect(page.getByText(/corpus[\\/]Video/)).toBeVisible();
        await capture(page, 'project/sources');
    });

    t('project/queue-basic', async ({page}) => {
        await openHowProject(page);
        // Four episodes from the Video folder (specials arrive in source.spec).
        for (const badge of ['S01E01', 'S01E02', 'S01E03', 'S01E04']) {
            await expect(queueItem(page, badge)).toBeVisible();
        }
        await expect(queueItem(page, 'S00E02')).toHaveCount(0);
        await capture(page, 'project/queue-basic');
    });

    t('project/queue-tracks', async ({page}) => {
        await openHowProject(page);
        const item = await expandQueueEpisode(page, 'S01E01');
        await expandQueueTrack(item, 'video');
        await capture(page, 'project/queue-tracks');
    });

    t('project/queue-track-comment', async ({page}) => {
        await openHowProject(page);
        const item = await expandQueueEpisode(page, 'S01E01');
        const flacHeader = await expandQueueTrack(item, 'audio');
        const row = flacHeader.locator('xpath=..');
        // Dispositions live in the expanded body: badges + dashed "+" button.
        await row.locator('button:has(svg.lucide-plus)').first().click();
        const popover = page.getByRole('dialog').filter({hasText: 'Dispositions'});
        await expect(popover).toBeVisible();
        const comment = popover.locator('div:has(> span:text-is("Comment"))').locator('button[role="switch"]');
        await comment.click();
        await expect(comment).toHaveAttribute('data-state', 'checked');
        await capture(page, 'project/queue-track-comment');
        await page.keyboard.press('Escape');
        // Queue track override is intentional; flush before reload.
        await flushProjectSave(page);
    });

    t('project/queue-container', async ({page}) => {
        await openHowProject(page);
        const item = await expandQueueEpisode(page, 'S01E01');
        await setQueueSection(item, 'container', true);
        await expect(item.getByText('Title', {exact: true})).toBeVisible();
        await capture(page, 'project/queue-container');
    });

    t('project/queue-chapters', async ({page}) => {
        await openHowProject(page);
        const item = await expandQueueEpisode(page, 'S01E01');
        await setQueueSection(item, 'container', false);
        await setQueueSection(item, 'chapters', true);
        await expect(item.getByText('Quality Check')).toBeVisible();
        await expect(item.getByText('4 entries')).toBeVisible();
        await capture(page, 'project/queue-chapters');
    });

    t('project/filename-tooltip', async ({page}) => {
        await openHowProject(page);
        const item = queueItem(page, 'S01E01');
        const filename = item.locator('span:has-text(".mkv")').first();
        // Real TMDB title for S01E01 flows into the rename template output.
        const tip = await hoverTooltip(
            page,
            filename,
            'S01E01 - Aluminum Foil, Snowboards, Contact Lenses, Bread',
        );
        await capture(page, 'project/filename-tooltip');
        // Move the pointer away so the tooltip hides for the dark pass.
        await page.mouse.move(0, 0);
        await expect(tip).toBeHidden();
    });

    t('project/disable-chapters-tooltip', async ({page}) => {
        await openHowProject(page);
        const item = await expandQueueEpisode(page, 'S01E01');
        await setQueueSection(item, 'chapters', true);
        // Per-source chapter group toggle — span[role=button] with a right-side
        // tooltip. (Track-level exclusion lives on the source preview, not in
        // the queue — EpisodeTrackRow has no exclude control.)
        const toggle = item.locator('span[role="button"]').first();
        const tip = await hoverTooltip(page, toggle, 'Click to disable chapters from this source');
        await capture(page, 'project/disable-chapters-tooltip');
        await page.mouse.move(0, 0);
        await expect(tip).toBeHidden();
    });
});
