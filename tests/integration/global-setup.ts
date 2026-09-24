/**
 * Playwright global setup:
 *   1. Generate the media corpus (lazy — no-op when already built).
 *   2. Reset + seed tests/integration/appdata (redirected Electron userData).
 *   3. Clear the temporary screenshot directory.
 */
import {mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {generateCorpus} from './generate-corpus';
import {seedAppData} from './seed-data';

export const SCREENSHOTS_TEMP_DIR = path.join(process.cwd(), 'media', 'screenshots-temporary');
export const SCREENSHOTS_DIR = path.join(process.cwd(), 'media', 'screenshots');
export const APPDATA_DIR = path.join(process.cwd(), 'tests', 'integration', 'appdata');
/** Failure marker written by failure-marker-reporter.ts; global teardown
 *  reads it to gate screenshot promotion. (Playwright's own `.last-run.json`
 *  is written only AFTER global teardown has run, and a `test.afterEach`
 *  declared in the shared fixtures module only attaches to the first spec
 *  file that imports it — a reporter observes the whole run.) */
export const RUN_FAILED_MARKER = path.join(process.cwd(), 'tests', 'results', '.integration-failed');

export default async function globalSetup(): Promise<void> {
    await generateCorpus();

    seedAppData();

    // Clear a stale marker from a previous failed run — this run starts clean.
    rmSync(RUN_FAILED_MARKER, {force: true});
    rmSync(SCREENSHOTS_TEMP_DIR, {recursive: true, force: true});
    mkdirSync(path.join(SCREENSHOTS_TEMP_DIR, 'dark'), {recursive: true});
    mkdirSync(path.join(SCREENSHOTS_TEMP_DIR, 'light'), {recursive: true});
}
