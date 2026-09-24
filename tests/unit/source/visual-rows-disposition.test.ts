import { describe, it, expect, vi } from 'vitest';

// visual-rows.ts → codec-mapping.ts → @app/preload (getCodecConstants) and
// stream-match.ts (getCodecEntryList). In the node test env the preload
// browser build reads from globalThis, which is undefined — stub the bridge
// so module-level codec-map init resolves instead of rejecting.
vi.mock('@app/preload', () => ({
    getCodecConstants: vi.fn(async () => ({})),
    getCodecEntryList: vi.fn(async () => []),
}));

import {
    matchToVisualRows,
    rowToValue,
    aggregateDispositionRows,
    emptyRow,
} from '@/components/source/utils/visual-rows';
import { getFieldDefs } from '@/components/source/config/field-definitions';
import type { VisualRow } from '@/components/source/types/stream-match-types';

const fieldDefs = getFieldDefs('audio');

/**
 * Regression tests for disposition filter serialization.
 *
 * Bug: adding a "Disposition" filter row via the visual UI created the parent
 * row with `operator: 'equal'` (from emptyRow), but `aggregateDispositionRows`
 * only recognized parents with `operator: 'allOf'`. The disposition sub-rows
 * were therefore never aggregated into `match.disposition` — the filter never
 * applied, never appeared in JSON mode, and never persisted on save.
 *
 * Presets worked because `matchToVisualRows`/`parseSelector` produce the
 * parent with `operator: 'allOf'`.
 */
describe('disposition filter serialization', () => {
    it('aggregates disposition sub-rows from a parent row with operator "equal" (freshly added via UI)', () => {
        // Shape produced by addRow() + addDisposition() before the fix:
        // the parent row keeps emptyRow's default 'equal' operator.
        const rows: VisualRow[] = [
            {
                field: 'disposition',
                operator: 'equal',
                value: '',
                patternFlags: '',
                subRows: [
                    { field: 'disposition.1', operator: 'equal', value: 'true', patternFlags: '', subRows: [] },
                    { field: 'disposition.64', operator: 'equal', value: 'false', patternFlags: '', subRows: [] },
                ],
            },
        ];

        const result = aggregateDispositionRows(rows, fieldDefs);

        expect(result).toEqual({
            '1': { equal: true },
            '64': { equal: false },
        });
    });

    it('aggregates disposition sub-rows from a parent row with operator "allOf" (preset-style)', () => {
        // Shape produced by matchToVisualRows/parseSelector for an existing preset.
        const rows: VisualRow[] = [
            {
                field: 'disposition',
                operator: 'allOf',
                value: '',
                patternFlags: '',
                subRows: [
                    { field: 'disposition.1', operator: 'equal', value: 'true', patternFlags: '', subRows: [] },
                    { field: 'disposition.64', operator: 'equal', value: 'false', patternFlags: '', subRows: [] },
                ],
            },
        ];

        const result = aggregateDispositionRows(rows, fieldDefs);

        expect(result).toEqual({
            '1': { equal: true },
            '64': { equal: false },
        });
    });

    it('round-trips a disposition match through visual rows and back', () => {
        const match: Record<string, unknown> = {
            codec: { equal: 86018 },
            language: { equal: 'jpn' },
            disposition: {
                '1': { equal: true },
                '64': { equal: false },
            },
        };

        const rows = matchToVisualRows(match, fieldDefs);
        const dispAgg = aggregateDispositionRows(rows, fieldDefs);

        expect(dispAgg).toEqual(match.disposition);
    });

    it('rowToValue converts a disposition sub-row to a boolean selector keyed by disposition flag', () => {
        const subRow: VisualRow = {
            field: 'disposition.128',
            operator: 'equal',
            value: 'true',
            patternFlags: '',
            subRows: [],
        };

        expect(rowToValue(subRow, fieldDefs)).toEqual({ '128': { equal: true } });
    });

    it('returns undefined when there are no disposition rows', () => {
        const rows: VisualRow[] = [emptyRow('language')];
        expect(aggregateDispositionRows(rows, fieldDefs)).toBeUndefined();
    });
});