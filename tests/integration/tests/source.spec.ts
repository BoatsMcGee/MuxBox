/**
 * Source page narrative — 23 screenshots in ONE sequential test.
 *
 * The source editor's state is incremental (match pattern, per-file metadata,
 * chapters, builder items, JSON edits), so the whole story runs without
 * reloading: add → edit → match → metadata → chapters → builder (filter,
 * modify, preprocess) → preview states → save → add the Specials source.
 */
import {test, expect} from '../helpers/fixtures';
import type {Locator, Page} from '@playwright/test';
import {capture} from '../helpers/screenshot';
import {
    configItem,
    ensureConfigExpanded,
    ensureFileExpanded,
    expandPreviewTrack,
    expectNoPageOverflow,
    expectNoPageScrollbar,
    fileRow,
    fillNumberField,
    flushProjectSave,
    hoverTooltip,
    openHowProject,
    openSection,
    previewSection,
    setMonacoJson,
    setPreviewSections,
    waitForMonacoFlush,
    waitForPreviewReady,
} from '../helpers/ui';
import {SPECIALS_DIR, VIDEO_DIR, stubDirectoryDialog} from '../helpers/fixtures';

/** The Match Pattern input (UiInputPrefix placeholder). */
function matchInput(page: Page): Locator {
    return page.getByPlaceholder(/S01E/);
}

/** Footer save button — label depends on new vs. edit mode. */
function footerButton(page: Page, name: string): Locator {
    return page.getByRole('button', {name, exact: true});
}

test.describe('Source', () => {
    test('source narrative', async ({page, app}) => {
        test.setTimeout(360_000);
        await stubDirectoryDialog(app, VIDEO_DIR);
        await openHowProject(page);

        // ── 1. Add a (second) source — source-new auto-opens the dialog ──
        await page
            .locator('div.border-2.border-dashed')
            .filter({hasText: 'Add Source'})
            .first()
            .click();
        await expect(page.getByRole('heading', {name: 'Add Source'})).toBeVisible();
        await waitForPreviewReady(page);
        await expect(page.locator('input[readonly]').first()).toHaveValue(VIDEO_DIR);
        // Same layout regression as project/layout-no-scrollbar: the source
        // editor sized its grid with `calc(100vh - 10rem)` inside `main`'s
        // padding, which overshot the viewport and pinned a scrollbar.
        await expectNoPageOverflow(page);
        await expectNoPageScrollbar(page);
        await capture(page, 'source/add');

        // Back out without saving: the builder steps below run against the
        // SEEDED source — its named match items (H264 AVC - English,
        // AAC 5.1 Surround, tlh - Not English) back the filter/modify shots.
        await page.getByRole('button', {name: '← Back'}).click();
        await expect(page.getByRole('heading', {name: 'Project Settings'})).toBeVisible();
        await page.getByText(/corpus[\\/]Video/).click();
        await expect(page.getByRole('heading', {name: 'Edit Source'})).toBeVisible();
        await waitForPreviewReady(page);

        // ── 2. edit — pattern typed, files filtered ──
        const pattern = matchInput(page);
        await pattern.click();
        await page.keyboard.press('Control+a');
        await page.keyboard.type('How');
        await expect(page.getByText('4/4 matched')).toHaveCount(0); // all match → counter hidden
        await capture(page, 'source/edit');

        // ── 3. match-basic — plain pattern, no capture groups highlighted ──
        await pattern.click();
        await page.keyboard.press('Control+a');
        await page.keyboard.type('\\.mkv$');
        // Flags load from the seeded source ('i' already active) — ensure ON
        // without toggling it off.
        const flagI = page.locator('button[title="Case insensitive"]');
        if (!/bg-primary/.test((await flagI.getAttribute('class')) ?? '')) {
            await flagI.click();
        }
        await expect(flagI).toHaveClass(/bg-primary/);
        await capture(page, 'source/match-basic');

        // ── 4. match-capture — capture groups restored ──
        await pattern.click();
        await page.keyboard.press('Control+a');
        await page.keyboard.type('s([0-9]+)e([0-9]+)');
        // Toggle the i flag and assert the flip rather than a fixed direction —
        // a pattern-flags re-parse on blur cannot make this expectation stale.
        const flagWasActive = /bg-primary/.test((await flagI.getAttribute('class')) ?? '');
        await flagI.click();
        if (flagWasActive) await expect(flagI).not.toHaveClass(/bg-primary/);
        else await expect(flagI).toHaveClass(/bg-primary/);
        await fillNumberField(page.locator('div:has(> label:text-is("Season Capture Group")) input').first(), '1');
        await fillNumberField(page.locator('div:has(> label:text-is("Episode Capture Group")) input').first(), '2');
        await capture(page, 'source/match-capture');

        // ── 5. metadata — container metadata copied to every episode ──
        await page.locator('button[title*="metadata" i]').click();
        await expect(page.locator('button[title*="metadata" i]')).toContainText('Remove Metadata');
        await capture(page, 'source/metadata');

        // ── 6. metadata-partial — episode 1 opts out of metadata ──
        await ensureFileExpanded(page, 's01e01');
        const containerRow = previewSection(page, 's01e01', 'container');
        await containerRow.locator('span[role="button"]').first().click();
        await expect(page.locator('button[title*="metadata" i]')).toContainText('(3/4)');
        await capture(page, 'source/metadata-partial');

        // ── 7. chapters — chapters copied to all episodes ──
        await page.locator('button[title*="chapters" i]').click();
        await expect(page.locator('button[title*="chapters" i]')).toContainText('Remove Chapters');
        await setPreviewSections(page, 's01e01', {chapters: true});
        await expect(fileRow_has(page, 'Quality Check')).toBeVisible();
        await capture(page, 'source/chapters');

        // ── 8. chapters-delayed — chapter delay applied to episode 1 ──
        const delayRow = page
            .locator('div:has(> span:text-is("Delay"))')
            .filter({hasText: 'ms'})
            .first();
        await fillNumberField(delayRow.locator('input[type="number"]').first(), '500');
        // Chapter timestamps now show original → shifted (delay applied).
        await expect(page.getByText('00:00:00.000 → 00:00:00.500').first()).toBeVisible();
        await capture(page, 'source/chapters-delayed');

        // ── 9. add-video-configuration — preset popover open ──
        await page.getByRole('tab', {name: 'Video'}).click();
        await page
            .locator('div.border-2.border-dashed')
            .filter({hasText: 'Add video Configuration'})
            .click();
        await expect(page.getByText('New Configuration')).toBeVisible();
        await capture(page, 'source/add-video-configuration');

        // ── 10. new-video-configuration — empty item added ──
        await page.getByRole('button', {name: 'New Configuration'}).click();
        await expect(configItem(page, 'Video Configuration')).toBeVisible();
        await capture(page, 'source/new-video-configuration');

        // ── 11. rename-video-configuration ──
        const newItem = configItem(page, 'Video Configuration');
        await newItem.locator('span.text-xs.font-medium', {hasText: 'Video Configuration'}).click();
        // Rename mode replaces the title span with an input — its value is not
        // text content, so the configItem filter no longer matches the row.
        const renameInput = page.locator('input.rename-input').first();
        await renameInput.fill('HEVC Fallback');
        await renameInput.press('Enter');
        await expect(configItem(page, 'HEVC Fallback')).toBeVisible();
        await capture(page, 'source/rename-video-configuration');

        // ── 12. save-video-configuration — Save As modal, cancelled ──
        const mainItem = await ensureConfigExpanded(page, 'H264 AVC - English');
        await mainItem.locator('button:has(svg.lucide-save)').click();
        const modal = page.getByRole('dialog').filter({hasText: 'Save As'});
        await expect(modal).toBeVisible();
        const presetName = modal.locator('input[placeholder="Preset name..."]');
        await expect(presetName).toHaveValue('H264 AVC - English');
        await presetName.fill('AVC English Rule');
        await capture(page, 'source/save-video-configuration');
        await modal.locator('button:text-is("Cancel")').click();
        await expect(modal).toBeHidden();

        // ── 13. filter-codec — video codec narrowed to H.264 ──
        // The Save As button's click bubbles into the header's toggle-collapse
        // handler and re-collapses the item — re-expand before reaching in.
        await ensureConfigExpanded(page, 'H264 AVC - English');
        await openSection(page, mainItem, 'Filter');
        // The section auto-creates a default 'Index' row — switch it to Codec.
        // (Clicking "Add filter" first would append Codec as a second row and
        // filter it out of row 1's options via usedFields.)
        const codecRow = mainItem.locator('div.mt-1.pl-3 > div.border.rounded-md.p-2').first();
        await codecRow.locator('select').first().selectOption('codec');
        const codecInput = codecRow.locator('input[placeholder="Type to search codec..."]');
        await codecInput.click();
        await codecInput.pressSequentially('264');
        const h264 = page.getByRole('option', {name: /AV_CODEC_ID_H264/}).first();
        await expect(h264).toBeVisible();
        await h264.click();
        await expect(codecInput).toHaveValue(/H264|h264/);
        await capture(page, 'source/filter-codec');

        // ── 14. filter-language — language narrowed to English ──
        await mainItem.locator('div:has-text("Add filter")').last().click();
        const langRow = mainItem.locator('div.mt-1.pl-3 > div.border.rounded-md.p-2').nth(1);
        await langRow.locator('select').first().selectOption('language');
        await fillNumberField(langRow.locator('input[placeholder="Value..."]').first(), 'eng');
        await capture(page, 'source/filter-language');

        // ── 15. filter-json — same match expressed as JSON ──
        const filterHeader = mainItem.locator('div.cursor-pointer').filter({
            has: page.locator('span:text-is("Filter")'),
        }).first();
        await filterHeader.locator('button:has(svg.lucide-braces)').click();
        // Schema requires selector objects ({equal: …}), not bare values.
        await setMonacoJson(mainItem, {
            codec: {equal: 27},
            language: {equal: 'eng'},
            width: {equal: 1920},
        });
        await waitForMonacoFlush(mainItem);
        await expect(mainItem.locator('.monaco-editor .view-lines')).toContainText('1920');
        await capture(page, 'source/filter-json');

        // ── 16. modify — subtitle rule gets language/title/disposition ──
        await page.getByRole('tab', {name: 'Subtitle'}).click();
        const subItem = await ensureConfigExpanded(page, 'tlh - Not English');
        await openSection(page, subItem, 'Modify');
        await fillNumberField(
            subItem.locator('div:has(> label:text-is("Language")) input').first(),
            'en-US',
        );
        await fillNumberField(
            subItem.locator('div:has(> label:text-is("Title")) input').first(),
            'Narration Track',
        );
        const dispGrid = subItem.locator('div.grid.grid-cols-3').first();
        await dispGrid.locator('button:has(svg.lucide-plus)').click();
        await page.getByRole('menuitem', {name: 'Comment'}).click();
        await expect(subItem.locator('span:text-is("Comment")')).toBeVisible();
        await capture(page, 'source/modify');

        // ── 17. modify-json — same modify expressed as JSON ──
        const modifyHeader = subItem.locator('div.cursor-pointer').filter({
            has: page.locator('span:text-is("Modify")'),
        }).first();
        await modifyHeader.locator('button:has(svg.lucide-braces)').click();
        // disposition values are Selector objects too (0x8 = AV_DISPOSITION_COMMENT).
        await setMonacoJson(subItem, {
            language: 'en-US',
            title: 'Narration Track',
            disposition: {8: {equal: true}},
        });
        await waitForMonacoFlush(subItem);
        await capture(page, 'source/modify-json');
        // Back to visual for the later delay edit.
        await modifyHeader.locator('button:has(svg.lucide-form)').click();
        await expect(subItem.locator('div.grid.grid-cols-3').first()).toBeVisible();

        // ── 18. preprocess — opusenc options on the 5.1 audio rule ──
        await page.getByRole('tab', {name: 'Audio'}).click();
        const audioItem = await ensureConfigExpanded(page, 'AAC 5.1 Surround');
        await openSection(page, audioItem, 'Preprocess');
        await fillNumberField(
            audioItem.locator('div:has(> label:text-is("Bitrate")) input').first(),
            '160',
        );
        await audioItem
            .locator('div:has(> label:text-is("Downmix")) select')
            .selectOption('stereo');
        await capture(page, 'source/preprocess');

        // ── 19. modify-delay — audio/subtitle delay field ──
        await page.getByRole('tab', {name: 'Subtitle'}).click();
        // Tab switches re-render the track list — the item is collapsed again.
        await ensureConfigExpanded(page, 'tlh - Not English');
        await openSection(page, subItem, 'Modify');
        await fillNumberField(
            subItem.locator('div:has(> label:text-is("Delay (ms)")) input').first(),
            '250',
        );
        await expect(
            subItem.locator('div:has(> label:text-is("Delay (ms)")) input'),
        ).toHaveValue('250');
        await capture(page, 'source/modify-delay');

        // ── 20. disable-subtitle — tlh rule matches nothing (red) ──
        await openSection(page, subItem, 'Filter');
        // Rows render the field as a native <select> — the seeded row is Language=tlh.
        const subLangRow = subItem
            .locator('div.mt-1.pl-3 > div.border.rounded-md.p-2')
            .first();
        await expect(subLangRow.locator('select').first()).toHaveValue('language');
        await expect(subLangRow.locator('input[placeholder="Value..."]')).toHaveValue('tlh');
        const subTrack = page
            .locator('button[data-stream-type="subtitle"][data-stream-index]')
            .first();
        await expect(subTrack.locator('svg.lucide-x').first()).toBeVisible();
        await hoverTooltip(page, subTrack.locator('span[role="button"]').first(), 'Track not matched');
        await capture(page, 'source/disable-subtitle');
        await page.mouse.move(0, 0);

        // ── 21. override-episode — per-file season/episode override ──
        await setPreviewSections(page, 's01e01', {episode: true});
        const epBody = page
            .locator('div.grid.grid-cols-2')
            .filter({has: page.locator('input[type="number"]')})
            .first();
        const seasonInput = epBody.locator('input[type="number"]').first();
        const episodeInput = epBody.locator('input[type="number"]').nth(1);
        await fillNumberField(seasonInput, '9');
        await fillNumberField(episodeInput, '9');
        await expect(page.getByText('S09E09').first()).toBeVisible();
        await capture(page, 'source/override-episode');
        // Clear the overrides — back to the parsed episode. Typing nothing
        // (fillNumberField('')) is a no-op and the number input ignores empty
        // values; the row's X button emits null. Assert on the episode CHIP
        // (page-wide getByText('S01E01') also matches the filename text).
        await seasonInput.locator('xpath=following-sibling::button[1]').click();
        await episodeInput.locator('xpath=following-sibling::button[1]').click();
        await expect(
            fileRow(page, 's01e01').getByRole('button', {name: 'S01E01', exact: true}),
        ).toBeVisible();

        // ── 22. raw-stream-info — raw StreamInfo dialog ──
        const videoTrack = await expandPreviewTrack(page, 's01e01', 'video');
        // The details panel is a SIBLING of the row button (StreamTrackRow root).
        await videoTrack
            .locator('..')
            .locator('button:text-is("Raw Stream Info")')
            .click();
        const rawDialog = page.getByRole('dialog').filter({hasText: 'Raw Data'});
        await expect(rawDialog).toBeVisible();
        await expect(rawDialog.locator('.monaco-editor')).toBeVisible();
        await capture(page, 'source/raw-stream-info');
        await page.keyboard.press('Escape');
        await expect(rawDialog).toBeHidden();

        // ── 23. disable-track — matched video track exclusion tooltip ──
        await hoverTooltip(
            page,
            videoTrack.locator('span[role="button"]').first(),
            'Click to exclude this track',
        );
        await capture(page, 'source/disable-track');
        await page.mouse.move(0, 0);

        // ── Save the source and verify the queue rebuilt ──
        await footerButton(page, 'Save Changes').click();
        await expect(page.getByRole('heading', {name: 'Project Settings'})).toBeVisible();
        await flushProjectSave(page);

        // ── Add the Specials source (second folder) ──
        await stubDirectoryDialog(app, SPECIALS_DIR);
        await page
            .locator('div.border-2.border-dashed')
            .filter({hasText: 'Add Source'})
            .first()
            .click();
        await expect(page.getByRole('heading', {name: 'Add Source'})).toBeVisible();
        await waitForPreviewReady(page, 's00e02', 'S00E02');
        await footerButton(page, 'Add Source').click();
        await expect(page.getByRole('heading', {name: 'Project Settings'})).toBeVisible();
        // Now the queue holds all six episodes.
        await expect(page.locator('div.border-b').filter({hasText: 'S00E02'}).first()).toBeVisible();
        await expect(page.locator('div.border-b').filter({hasText: 'S00E03'}).first()).toBeVisible();
        await flushProjectSave(page);
    });
});

/** Local assertion helper: the preview (right column) shows this text. */
function fileRow_has(page: Page, text: string): Locator {
    return page
        .locator('section')
        .filter({hasText: 'Stream Match Preview'})
        .first()
        .getByText(text)
        .first();
}