/**
 * Navigation + UI helpers shared by the screenshot specs.
 *
 * The router uses in-memory history (no URL bar), so navigation goes through
 * the UI. `reloadApp()` resets the router to the landing page and re-applies
 * the determinism CSS — the standard way to return to a known state.
 */
import {expect} from '@playwright/test';
import type {Locator, Page} from '@playwright/test';
import {injectDeterminismCss} from './fixtures';
import {PROJECT_HOW_ID, PROJECT_NEW_ID} from '../seed-data';

/** Reload the app and wait for the landing page ("Projects" card). */
export async function reloadApp(page: Page): Promise<void> {
    await page.reload({waitUntil: 'load'});
    await injectDeterminismCss(page);
    await expect(page.getByRole('heading', {name: 'MuxBox'})).toBeVisible();
}

/** Landing → project page by project name (project rows are sorted by lastOpened). */
export async function openProject(page: Page, name: string): Promise<void> {
    await reloadApp(page);
    await openProjectInPlace(page, name);
}

/** Open a project without reloading — assumes we are on the landing page. */
export async function openProjectInPlace(page: Page, name: string): Promise<void> {
    const rows = page.locator('div.divide-y > div');
    await rows.filter({hasText: name}).first().click();
    await expect(page.getByRole('heading', {name: 'Project Settings'})).toBeVisible();
}

export async function openHowProject(page: Page): Promise<void> {
    await openProject(page, 'How');
    await waitForQueueReady(page);
}

export async function openNewProject(page: Page): Promise<void> {
    await openProject(page, 'New Project');
}

/** Landing (or anywhere) → Settings via the gear button. */
export async function openSettings(page: Page): Promise<void> {
    await reloadApp(page);
    await page.locator('button:has(svg.lucide-settings)').first().click();
    await expect(page.getByRole('heading', {name: 'Settings', level: 1})).toBeVisible();
}

// ─── Episode queue ──────────────────────────────────────────────

/** The queue item (row) containing the given SxxEyy badge. */
export function queueItem(page: Page, badge: string): Locator {
    return page.locator('div.border-b').filter({hasText: badge}).first();
}

/** Wait until the queue finished probing S01E01: the status badge leaves
 *  'loading' and the stream-count pill shows the probed total
 *  (aria-label "Video: 1 stream" from getStreamTypeTooltip, variant total). */
export async function waitForQueueReady(page: Page): Promise<void> {
    const item = queueItem(page, 'S01E01');
    await expect(item).toBeVisible();
    await expect(item.getByText('loading', {exact: true})).toHaveCount(0);
    await expect(item.locator('[aria-label="Video: 1 stream"]')).toBeVisible();
}

/** Expand a queue episode (accordion — expands exactly one episode).
 *  The header chevron is a lucide-chevron-down that gains .rotate-180. */
export async function expandQueueEpisode(page: Page, badge: string): Promise<Locator> {
    const item = queueItem(page, badge);
    await expect(item).toBeVisible();
    const header = item.locator('div.cursor-pointer').first();
    const isExpanded = (await header.locator('svg.lucide-chevron-down.rotate-180').count()) > 0;
    if (!isExpanded) await header.click();
    await expect(item.locator('button[data-queue-section="container"]')).toBeVisible();
    return item;
}

/** Toggle a queue section (container/chapters) to a known open/closed state. */
export async function setQueueSection(
    item: Locator,
    section: 'container' | 'chapters',
    open: boolean,
): Promise<void> {
    const row = item.locator(`[data-queue-section="${section}"]`);
    await expect(row).toBeVisible();
    const chevronUp = row.locator('svg.lucide-chevron-up');
    const isOpen = (await chevronUp.count()) > 0;
    if (isOpen !== open) await row.click();
    if (open) await expect(row.locator('svg.lucide-chevron-up')).toBeVisible();
    else await expect(row.locator('svg.lucide-chevron-down')).toBeVisible();
}

/** Click a track row in the queue (button[data-stream-type]) and wait for it
 *  to expand — EpisodeTrackRow's inline svg chevron gains .rotate-180. */
export async function expandQueueTrack(item: Locator, type: string): Promise<Locator> {
    const row = item.locator(`button[data-stream-type="${type}"]`).first();
    await expect(row).toBeVisible();
    if ((await row.locator('svg.rotate-180').count()) === 0) await row.click();
    await expect(row.locator('svg.rotate-180')).toHaveCount(1);
    return row;
}

/** Preview area (right column) on the source page. */
export function preview(page: Page): Locator {
    return page.locator('section').filter({hasText: 'Stream Match Preview'}).first();
}

export function fileRow(page: Page, file: string): Locator {
    return preview(page).locator('button').filter({hasText: file}).first();
}

/** Wait until stream info finished loading (SxxEyy badge appears in the row). */
export async function waitForPreviewReady(page: Page, file = 's01e01', badge?: string): Promise<void> {
    await expect(fileRow(page, file).getByText(badge ?? 'S01E01')).toBeVisible();
}

/** Expand/collapse a preview file row to a known state (accordion — one open). */
export async function ensureFileExpanded(page: Page, file: string): Promise<Locator> {
    const row = fileRow(page, file);
    await expect(row).toBeVisible();
    const isOpen = (await row.locator('svg.lucide-chevron-up').count()) > 0;
    if (!isOpen) await row.click();
    await expect(row.locator('svg.lucide-chevron-up')).toBeVisible();
    return row;
}

/** Collapse the preview file if expanded (used to reset sections). */
export async function collapseFile(page: Page, file: string): Promise<void> {
    const row = fileRow(page, file);
    if ((await row.locator('svg.lucide-chevron-up').count()) > 0) {
        await row.click();
    }
}

/** Locate a preview section row (episode/container/chapters) inside a file.
 *  Sections are SIBLINGS of the file header button (same StreamFileRow root),
 *  so scope via the header's parent. chapters carries data-stream-type=
 *  "chapters"; the container row has no data attribute, so all three are
 *  matched by their span.font-medium label. */
export function previewSection(page: Page, file: string, section: 'episode' | 'container' | 'chapters'): Locator {
    const root = fileRow(page, file).locator('xpath=..');
    if (section === 'container') {
        return root.locator('button:has(> span.font-medium:text-is("Container"))');
    }
    if (section === 'chapters') {
        return root.locator('button:has(> span.font-medium:text-is("Chapters"))');
    }
    return root.locator('button:has(> span.font-medium:has-text("Season "))');
}

/**
 * Set which preview sections (episode/container/chapters) are open for a file.
 * Section toggles are independent (Set of `file::section` keys).
 */
export async function setPreviewSections(
    page: Page,
    file: string,
    wanted: {episode?: boolean; container?: boolean; chapters?: boolean},
): Promise<void> {
    await ensureFileExpanded(page, file);
    for (const section of ['episode', 'container', 'chapters'] as const) {
        const target = wanted[section] ?? false;
        const btn = previewSection(page, file, section);
        if ((await btn.count()) === 0) continue;
        const isOpen = (await btn.locator('svg.lucide-chevron-up').count()) > 0;
        if (isOpen !== target) await btn.click();
        if (target) await expect(btn.locator('svg.lucide-chevron-up')).toBeVisible();
    }
}

/** Expand exactly one track in the preview file; collapses others.
 *  (Track headers carry data-stream-type/data-stream-index and swap chevrons.) */
export async function expandPreviewTrack(page: Page, file: string, type: string): Promise<Locator> {
    const header = await ensureFileExpanded(page, file);
    // Track rows live in the expanded body — a SIBLING of the header button
    // (same StreamFileRow root), like previewSection above.
    const root = header.locator('xpath=..');
    const expanded = root.locator('button[data-stream-type][data-stream-index]:has(svg.lucide-chevron-up)');
    const count = await expanded.count();
    for (let i = 0; i < count; i++) {
        const trackRow = expanded.first();
        const trackType = await trackRow.getAttribute('data-stream-type');
        if (trackType !== type) await trackRow.click();
    }
    const target = root
        .locator(`button[data-stream-type="${type}"][data-stream-index]`)
        .first();
    await expect(target).toBeVisible();
    if ((await target.locator('svg.lucide-chevron-up').count()) === 0) await target.click();
    await expect(target.locator('svg.lucide-chevron-up')).toBeVisible();
    return target;
}

/** Expand a config item if collapsed (its HEADER shows ChevronRight when
 *  closed — section headers also contain ChevronRight, so scope to header). */
export async function ensureConfigExpanded(page: Page, name: string): Promise<Locator> {
    const item = configItem(page, name);
    await expect(item).toBeVisible();
    const header = item.locator('div.cursor-pointer').first();
    if ((await header.locator('svg.lucide-chevron-right').count()) > 0) {
        await header.click();
    }
    await expect(header.locator('svg.lucide-chevron-down')).toBeVisible();
    return item;
}

/** The StreamMatchItem card containing a configuration with this name. */
export function configItem(page: Page, name: string): Locator {
    return page.locator('div.border.rounded-md.p-2').filter({
        has: page.getByText(name, {exact: true}),
    }).first();
}

/** Open a Filter/Modify/Preprocess accordion section inside a config item
 *  (single-active: the open section header shows a ChevronDown). */
export async function openSection(page: Page, item: Locator, section: 'Filter' | 'Modify' | 'Preprocess'): Promise<void> {
    const header = item.locator('div.cursor-pointer').filter({
        has: page.locator(`span:text-is("${section}")`),
    }).first();
    await expect(header).toBeVisible();
    if ((await header.locator('svg.lucide-chevron-down').count()) === 0) {
        await header.click();
    }
    await expect(header.locator('svg.lucide-chevron-down')).toBeVisible();
    await expect(item.locator('div.mt-1.pl-3')).toBeVisible();
}

/** Read the JSON text currently displayed in a Monaco editor inside `scope`. */
export async function readMonacoJson(scope: Locator): Promise<Record<string, unknown>> {
    const text = await scope.locator('.monaco-editor .view-lines').first().innerText();
    return JSON.parse(text) as Record<string, unknown>;
}

/** Replace the full content of a Monaco editor.
 *  Typing via insertText triggers Monaco's JSON auto-closing/auto-indent (a
 *  stray brace pins the error dot forever), so stage the text on the
 *  clipboard and paste — paste inserts verbatim. The content cannot be
 *  verified via innerText here: the editor height derives from the initial
 *  modelValue and does not grow, so .view-lines only renders the visible
 *  tail. The call sites' waitForMonacoFlush is the verification (parse +
 *  schema markers + commit). */
export async function setMonacoJson(scope: Locator, value: Record<string, unknown>): Promise<void> {
    const editor = scope.locator('.monaco-editor .view-lines').first();
    const page = editor.page();
    const target = JSON.stringify(value, null, 2);

    // execCommand('copy') works in Electron without clipboard-write permissions.
    await page.evaluate((text) => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }, target);

    await editor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+v');
}

/** Wait until the Monaco dirty indicator (orange dot) on a toggle button clears. */
export async function waitForMonacoFlush(item: Locator): Promise<void> {
    await expect.poll(async () => item.locator('.bg-orange-400, .bg-destructive').count(), {
        timeout: 10_000,
    }).toBe(0);
}

/** Fill a Reka NumberField input reliably (types + commits via Tab). */
export async function fillNumberField(input: Locator, value: string): Promise<void> {
    await input.click();
    await input.page().keyboard.press('Control+a');
    await input.page().keyboard.type(value);
    await input.page().keyboard.press('Tab');
}

/** Locator for a labeled Reka NumberField/row input (label is a sibling). */
export function labeledControl(scope: Locator, labelText: string): Locator {
    return scope.locator(`div:has(> label:text-is("${labelText}")) input`).first();
}

/** Hover a locator and wait for its Reka tooltip to become visible. */
export async function hoverTooltip(page: Page, trigger: Locator, text?: string | RegExp): Promise<Locator> {
    await trigger.scrollIntoViewIfNeeded();
    await trigger.hover();
    // Reka renders role="tooltip" on an aria-hidden, visually-clipped mirror
    // span INSIDE the styled content — the visible layer is its parent.
    const tooltip = page.locator('[role="tooltip"]').locator('..');
    await expect(tooltip).toBeVisible();
    if (text !== undefined) await expect(tooltip).toContainText(text);
    return tooltip;
}

/** Wait past the project autosave debounce (500ms) + write so the state is
 *  on disk before the next test reloads the app. */
export async function flushProjectSave(page: Page): Promise<void> {
    await page.waitForTimeout(900);
}

export {PROJECT_HOW_ID, PROJECT_NEW_ID};
