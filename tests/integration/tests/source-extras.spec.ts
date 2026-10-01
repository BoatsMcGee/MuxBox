/**
 * Standalone Source-page specs that need their OWN stream-configuration rule.
 *
 * The seeded "How" project ships with subtitles disabled (its only subtitle
 * rule matches Klingon, which is absent from the corpus). These tests replace
 * that rule for their own run rather than changing the seed, so no other spec
 * is affected — each test reloads the app first and mutates a throwaway copy
 * of the project state.
 */
import {test, expect} from '../helpers/fixtures';
import {capture} from '../helpers/screenshot';
import {
    ensureConfigExpanded,
    ensureFileExpanded,
    expandPreviewTrack,
    fillNumberField,
    flushProjectSave,
    openHowProject,
    openSection,
    waitForPreviewReady,
} from '../helpers/ui';
import {VIDEO_DIR, stubDirectoryDialog} from '../helpers/fixtures';
import type {Locator, Page} from '@playwright/test';

test.describe('Source — opusenc preprocessing', () => {
    test('source/opusenc-preprocess', async ({page, app}) => {
        await stubDirectoryDialog(app, VIDEO_DIR);
        await openHowProject(page);

        // ── Open the seeded source in EDIT mode ──
        // The named match items (AAC 5.1 Surround, tlh - Not English) live on the
        // seeded source, so edit it rather than the empty "Add Source" dialog.
        await page.getByText(/corpus[\\/]Video/).click();
        await expect(page.getByRole('heading', {name: 'Edit Source'})).toBeVisible();
        await waitForPreviewReady(page);

        // ── Audio tab: the 5.1 rule is the natural opusenc candidate ──
        await page.getByRole('tab', {name: 'Audio'}).click();
        const a51 = await ensureConfigExpanded(page, 'AAC 5.1 Surround');
        await openSection(page, a51, 'Preprocess');

        // ── opusenc options: bitrate, downmix, complexity, frame size ──
        await fillNumberField(
            a51.locator('div:has(> label:text-is("Bitrate")) input').first(),
            '128',
        );
        await a51.locator('div:has(> label:text-is("Downmix")) select').selectOption('stereo');
        await a51.locator('div:has(> label:text-is("Complexity")) select').selectOption('5');
        await a51.locator('div:has(> label:text-is("Frame Size (ms)")) select').selectOption('20');
        // The two workarounds are plain checkboxes.
        await a51.locator('div:has(> label:text-is("Volume Workaround")) input').check();
        await a51.locator('div:has(> label:text-is("Normalize")) input').check();

        await expect(
            a51.locator('div:has(> label:text-is("Bitrate")) input').first(),
        ).toHaveValue('128');
        await expect(
            a51.locator('div:has(> label:text-is("Downmix")) select'),
        ).toHaveValue('stereo');
        await expect(
            a51.locator('div:has(> label:text-is("Frame Size (ms)")) select'),
        ).toHaveValue('20');
        await capture(page, 'source/opusenc-preprocess');

        // The preview predicts the resulting codec for this track.
        const track = await expandPreviewTrack(page, 's01e01', 'audio');
        const codecRow = track.locator('..').locator('div.grid.grid-cols-2').first();
        await expect(codecRow).toContainText('OPUS');

        await flushProjectSave(page);
    });
});

test.describe('Source — excluded subtitle track', () => {
    test('source/exclude-subtitle-track', async ({page, app}) => {
        await stubDirectoryDialog(app, VIDEO_DIR);
        await openHowProject(page);

        await page.locator('div.border-2.border-dashed').filter({hasText: 'Add Source'}).first()
            .click();
        await expect(page.getByRole('heading', {name: 'Add Source'})).toBeVisible();
        await page.getByRole('button', {name: '← Back'}).click();
        await expect(page.getByRole('heading', {name: 'Project Settings'})).toBeVisible();
        await page.getByText(/corpus[\\/]Video/).click();
        await expect(page.getByRole('heading', {name: 'Edit Source'})).toBeVisible();
        await waitForPreviewReady(page);

        // ── Replace the unmatched tlh rule with one that matches English ──
        // Using this test's own edit (not the seed) keeps every other spec's
        // "Track not matched" assertion intact.
        await page.getByRole('tab', {name: 'Subtitle'}).click();
        const tlh = await ensureConfigExpanded(page, 'tlh - Not English');
        // The Filter section must be open before its rows are reachable.
        await openSection(page, tlh, 'Filter');
        const langRow = tlh.locator('div.mt-1.pl-3 > div.border.rounded-md.p-2').first();
        await fillNumberField(langRow.locator('input[placeholder="Value..."]').first(), 'eng');
        await expect(langRow.locator('input[placeholder="Value..."]').first()).toHaveValue('eng');

        // ── The English track is now matched (green check, no ✗) ──
        // Track rows only render inside an expanded preview file row. Do NOT
        // expand a single track: the exclusion badge sits on every row, and
        // expanding one hides the others behind the accordion.
        await ensureFileExpanded(page, 's01e01');
        const engTrack = firstMatchedSubtitle(page);
        const toggle = engTrack.locator('span[role="button"]').first();
        await expect(toggle.locator('svg.lucide-check')).toBeVisible();

        // ── Exclude it via the toggle ──
        // The exclusion tooltip is already covered by source/disable-track, so
        // this test asserts the state change and screenshots both states.
        await toggle.click();
        // Excluded rows swap the green check for the 🛇 shield glyph.
        await expect(toggle.locator('svg.lucide-check')).toHaveCount(0);
        await expect(toggle).toContainText('🛇');
        await capture(page, 'source/exclude-subtitle-track');

        // Re-include so the row returns to its matched state.
        await toggle.click();
        await expect(toggle.locator('svg.lucide-check')).toBeVisible();
        await capture(page, 'source/exclude-subtitle-restored');

        await flushProjectSave(page);
    });
});

/** The first preview subtitle track that is NOT the unmatched (✗) one. */
function firstMatchedSubtitle(page: Page): Locator {
    return page
        .locator('button[data-stream-type="subtitle"][data-stream-index]')
        .filter({hasNot: page.locator('svg.lucide-x')})
        .first();
}