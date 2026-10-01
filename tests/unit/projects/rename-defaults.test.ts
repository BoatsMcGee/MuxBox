/**
 * Tests for the global default rename template seeded into new projects.
 *
 * Settings stores a default rename template and field config; `createProject`
 * copies both into the new project's `rename` block at creation time. Projects
 * already on disk are never touched, so these tests pin the snapshot
 * semantics: the value is applied once, at creation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    createDefaultProjectData,
    DEFAULT_RENAME_TEMPLATE,
    DEFAULT_RENAME_FIELD_CONFIG,
} from '@app/projects';

const HERE = dirname(fileURLToPath(import.meta.url));

// ─── Built-in fallback ──────────────────────────────────────────

describe('createDefaultProjectData rename defaults', () => {
    it('uses the built-in template when no override is given', () => {
        const data = createDefaultProjectData('p1');
        expect(data.rename.template).toBe(DEFAULT_RENAME_TEMPLATE);
        expect(data.rename.enabled).toBe(true);
    });

    it('uses the built-in field config when no override is given', () => {
        const data = createDefaultProjectData('p1');
        expect(data.rename.fieldConfig).toEqual(DEFAULT_RENAME_FIELD_CONFIG);
    });

    it('keeps the built-in field config unchanged between projects', () => {
        // Guards the deep clone: mutating one project's prefix must not leak
        // into the next project or back into the module-level default.
        const first = createDefaultProjectData('p1');
        first.rename.fieldConfig!['{{SEASON_NUMBER}}']!.prefix = 'X';
        first.rename.fieldConfig!['{{SEASON_NUMBER}}']!.padding = 4;

        const second = createDefaultProjectData('p2');
        expect(second.rename.fieldConfig!['{{SEASON_NUMBER}}']!.prefix).toBe('S');
        expect(second.rename.fieldConfig!['{{SEASON_NUMBER}}']!.padding).toBeUndefined();
        expect(DEFAULT_RENAME_FIELD_CONFIG['{{SEASON_NUMBER}}']!.prefix).toBe('S');
    });
});

// ─── Overrides ──────────────────────────────────────────────────

describe('createDefaultProjectData rename overrides', () => {
    it('applies a custom template and field config', () => {
        const data = createDefaultProjectData('p1', {
            renameTemplate: '{{SERIES_NAME}} - {{EPISODE_NAME}}',
            fieldConfig: { '{{EPISODE_NAME}}': { prefix: '[', suffix: ']', alwaysAdd: true } },
        });
        expect(data.rename.template).toBe('{{SERIES_NAME}} - {{EPISODE_NAME}}');
        expect(data.rename.fieldConfig).toEqual({
            '{{EPISODE_NAME}}': { prefix: '[', suffix: ']', alwaysAdd: true },
        });
    });

    it('leaves the other half at the built-in default when only one is given', () => {
        const templateOnly = createDefaultProjectData('p1', {
            renameTemplate: '{{SERIES_NAME}}',
        });
        expect(templateOnly.rename.template).toBe('{{SERIES_NAME}}');
        expect(templateOnly.rename.fieldConfig).toEqual(DEFAULT_RENAME_FIELD_CONFIG);

        const configOnly = createDefaultProjectData('p2', {
            fieldConfig: { '{{SEASON_NUMBER}}': { prefix: 'Season ', suffix: '', alwaysAdd: false } },
        });
        expect(configOnly.rename.template).toBe(DEFAULT_RENAME_TEMPLATE);
        expect(configOnly.rename.fieldConfig).toEqual({
            '{{SEASON_NUMBER}}': { prefix: 'Season ', suffix: '', alwaysAdd: false },
        });
    });

    it('falls back to the built-in template for a blank override', () => {
        // A cleared Settings field must never produce an empty filename.
        for (const blank of ['', '   ', '\n\t']) {
            const data = createDefaultProjectData('p1', { renameTemplate: blank });
            expect(data.rename.template).toBe(DEFAULT_RENAME_TEMPLATE);
        }
    });

    it('copies the field config instead of aliasing the caller object', () => {
        const source = { '{{SEASON_NUMBER}}': { prefix: 'S', suffix: '', alwaysAdd: false } };
        const data = createDefaultProjectData('p1', { fieldConfig: source });
        data.rename.fieldConfig!['{{SEASON_NUMBER}}']!.prefix = 'Z';
        // The settings store owns the object it handed over; editing the
        // project's copy must not write back into global settings.
        expect(source['{{SEASON_NUMBER}}']!.prefix).toBe('S');
    });
});

// ─── DEFAULT_SETTINGS parity ────────────────────────────────────

describe('AppSettings rename defaults', () => {
    const SETTINGS_SOURCES = [
        '../../../packages/settings/src/types.ts',
        '../../../packages/preload/src/main-exports.ts',
    ];

    it('declares both keys as undefined in every DEFAULT_SETTINGS copy', () => {
        // AppSettings is intentionally declared twice — once canonically and
        // once for the main process. Both must gain new keys together, or the
        // main process silently drops whatever the renderer saved.
        for (const rel of SETTINGS_SOURCES) {
            const src = readFileSync(resolve(HERE, rel), 'utf-8');
            for (const key of ['defaultRenameTemplate', 'defaultRenameFieldConfig']) {
                const m = src.match(new RegExp(`${key}:\\s*([^,\\n}]+)`));
                expect(m, `no ${key} default found in ${rel}`).not.toBeNull();
                expect(
                    m![1]!.trim(),
                    `${rel} sets ${key} to ${m![1]!.trim()}; it must be undefined so existing settings.json files inherit the built-in default`,
                ).toBe('undefined');
            }
        }
    });

    it('declares both keys on the AppSettings interface in every copy', () => {
        for (const rel of SETTINGS_SOURCES) {
            const src = readFileSync(resolve(HERE, rel), 'utf-8');
            expect(src, `${rel} is missing defaultRenameTemplate on AppSettings`).toMatch(
                /defaultRenameTemplate\?:\s*string/,
            );
            expect(src, `${rel} is missing defaultRenameFieldConfig on AppSettings`).toMatch(
                /defaultRenameFieldConfig\?:\s*Record<string,\s*FieldConfig>/,
            );
        }
    });
});
