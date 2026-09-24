import {appendFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import type {Reporter, TestCase, TestResult} from '@playwright/test/reporter';
import {RUN_FAILED_MARKER} from './global-setup';

/**
 * Writes a marker file as soon as any test fails so global teardown can
 * gate screenshot promotion.
 *
 * Reporters observe every test of the run; neither of the obvious
 * alternatives does: Playwright's `.last-run.json` is only written AFTER
 * global teardown, and a `test.afterEach` declared in the shared fixtures
 * module attaches to the first spec file that happens to import it.
 */
export default class FailureMarkerReporter implements Reporter {
    onTestEnd(test: TestCase, result: TestResult): void {
        if (result.status !== 'failed' && result.status !== 'timedOut') return;
        mkdirSync(path.dirname(RUN_FAILED_MARKER), {recursive: true});
        appendFileSync(RUN_FAILED_MARKER, `${test.title}\n`);
    }
}
