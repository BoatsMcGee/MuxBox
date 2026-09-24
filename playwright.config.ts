import {defineConfig} from '@playwright/test';

/**
 * Integration test suite for MuxBox.
 *
 * - Single worker: the Electron app instance and its appdata state are shared
 *   across tests; several specs rely on ordered, incremental UI interaction.
 * - global-setup generates the corpus + seeds appdata; global-teardown encodes
 *   screenshots to AVIF and cleans up when everything passed.
 */
export default defineConfig({
    testDir: './tests/integration/tests',
    globalSetup: './tests/integration/global-setup.ts',
    globalTeardown: './tests/integration/global-teardown.ts',
    // The failure marker (.integration-failed) and Playwright artifacts live
    // under tests/results/ (Playwright's default outputDir is test-results/).
    outputDir: 'tests/results',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 120_000,
    expect: {timeout: 15_000},
    reporter: [['list'], ['./tests/integration/failure-marker-reporter.ts']],
    use: {
        trace: 'off',
        video: 'off',
        screenshot: 'off',
    },
});
