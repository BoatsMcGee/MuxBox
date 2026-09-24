import { type Ref } from 'vue';
import type { StreamItem } from '@/components/source/types/stream-match-constants';
import type { StreamType } from '@/components/source/types/stream-match-constants';
import type { FieldDef, VisualRow } from '@/components/source/types/stream-match-types';
import { getFieldDefs } from '@/components/source/config/field-definitions';
import { operatorOptions, isNestedOp, isTerminalOp } from '@/components/source/config/operator-options';
import {
    emptyRow,
    deepCopyRows,
    matchToVisualRows,
    rowToValue,
    getRowAt,
    aggregateDispositionRows,
} from '@/components/source/utils/visual-rows';
import { DISPOSITION_OPTIONS } from '@/components/source/config/disposition-options';

interface VisualRowsContext {
    items: Ref<StreamItem[]>;
    visualRowsByItem: Ref<Map<string, VisualRow[]>>;
    emitChange: () => void;
}

export function useBuilderVisualRows(
    props: { streamType: string },
    ctx: VisualRowsContext,
) {
    const { visualRowsByItem, emitChange } = ctx;

    function getFieldDefsForType(): FieldDef[] {
        return getFieldDefs(props.streamType as StreamType);
    }

    // ─── Visual row helpers ─────────────────────────────────────

    function getVisualRows(item: StreamItem): VisualRow[] {
        const existing = visualRowsByItem.value.get(item.id);
        if (existing && existing.length > 0) return existing;

        const fieldDefs = getFieldDefsForType();
        const parsed = matchToVisualRows(item.match, fieldDefs);
        if (parsed.length > 0) {
            visualRowsByItem.value.set(item.id, parsed);
            return parsed;
        }

        const defaultRow = [emptyRow(fieldDefs[0]?.value ?? '')];
        visualRowsByItem.value.set(item.id, defaultRow);
        return defaultRow;
    }

    function applyRows(item: StreamItem, rows: VisualRow[]) {
        visualRowsByItem.value.set(item.id, deepCopyRows(rows));

        const fieldDefs = getFieldDefsForType();
        const match: Record<string, unknown> = {};
        // First handle non-disposition rows (and disposition parent row)
        for (const row of rows) {
            if (row.field !== 'disposition') {
                const val = rowToValue(row, fieldDefs);
                if (val !== undefined) {
                    match[row.field] = val;
                }
            }
        }
        // Then aggregate ALL disposition sub-rows recursively into a single disposition object
        const dispAgg = aggregateDispositionRows(rows, fieldDefs);
        if (dispAgg) {
            match.disposition = dispAgg;
        }
        item.match = match;
        emitChange();
    }

    function getAvailableOperators(fieldValue: string) {
        const fieldDefs = getFieldDefsForType();
        const fd = fieldDefs.find((f) => f.value === fieldValue);
        const ft = fd?.type ?? 'string';
        return operatorOptions.filter((op) => op.appliesTo.includes(ft));
    }

    // ─── Row CRUD ───────────────────────────────────────────────

    function addRow(item: StreamItem) {
        const rows = getVisualRows(item);
        const fieldDefs = getFieldDefsForType();
        const used = new Set(rows.map((r) => r.field));
        const avail = fieldDefs.find((f) => !used.has(f.value));
        if (avail) {
            const newRow = emptyRow(avail.value);
            // Disposition rows are containers for disposition sub-rows; use the
            // canonical 'allOf' shape so aggregation always recognizes them.
            if (avail.value === 'disposition') {
                newRow.operator = 'allOf';
            }
            rows.push(newRow);
        }
        applyRows(item, rows);
    }

    function removeRow(item: StreamItem, path: number[]) {
        const rows = getVisualRows(item);
        if (path.length === 1) {
            rows.splice(path[0], 1);
        } else {
            const parent = getRowAt(rows, path.slice(0, -1));
            if (parent) {
                parent.subRows.splice(path[path.length - 1], 1);
                if (parent.operator === 'not' && parent.subRows.length === 0) {
                    parent.subRows.push(emptyRow(parent.field));
                }
            }
        }
        applyRows(item, rows);
    }

    function updateRowField(item: StreamItem, path: number[], field: string) {
        const rows = getVisualRows(item);
        const r = getRowAt(rows, path);
        if (!r) return;
        r.field = field;
        if (field === 'disposition') {
            // Disposition rows are containers for disposition sub-rows; force the
            // canonical 'allOf' shape so aggregation always recognizes them.
            r.operator = 'allOf';
            r.subRows = [];
        } else {
            const ops = getAvailableOperators(field);
            if (!ops.some((o) => o.value === r.operator)) {
                r.operator = 'equal';
                r.subRows = [];
            }
            const patchField = (row: VisualRow) => {
                row.field = field;
                row.subRows.forEach(patchField);
            };
            r.subRows.forEach(patchField);
        }
        applyRows(item, rows);
    }

    function updateRowOp(item: StreamItem, path: number[], op: string) {
        const rows = getVisualRows(item);
        const r = getRowAt(rows, path);
        if (!r) return;
        r.operator = op;
        r.patternFlags = '';
        if (isNestedOp(op)) {
            r.subRows = [emptyRow(r.field)];
        } else {
            r.subRows = [];
        }
        applyRows(item, rows);
    }

    function updateRowValue(item: StreamItem, path: number[], value: string) {
        const rows = getVisualRows(item);
        const r = getRowAt(rows, path);
        if (r) {
            r.value = value;
            applyRows(item, rows);
        }
    }

    function togglePatternFlag(item: StreamItem, path: number[], flag: string) {
        const rows = getVisualRows(item);
        const r = getRowAt(rows, path);
        if (!r || r.operator !== 'pattern') return;
        const flags = r.patternFlags;
        if (flags.includes(flag)) {
            r.patternFlags = flags.replace(flag, '');
        } else {
            r.patternFlags = flags + flag;
        }
        applyRows(item, rows);
    }

    // ─── Nested sub-row helpers ─────────────────────────────────

    function addSubRow(item: StreamItem, path: number[]) {
        const rows = getVisualRows(item);
        const p = getRowAt(rows, path);
        if (!p) return;

        if (!isNestedOp(p.operator)) return;

        if (p.operator === 'not') {
            p.subRows = [emptyRow(p.field)];
        } else {
            p.subRows.push(emptyRow(p.field));
        }
        applyRows(item, rows);
    }

    function removeSubRow(item: StreamItem, path: number[], subIndex: number) {
        const rows = getVisualRows(item);
        const p = getRowAt(rows, path);
        if (!p) return;
        p.subRows.splice(subIndex, 1);
        if (p.operator === 'not' && p.subRows.length === 0) {
            p.subRows.push(emptyRow(p.field));
        }
        applyRows(item, rows);
    }

    // ─── Disposition match helpers (visual builder) ─────────────

    function addDisposition(item: StreamItem, path: number[], dispKey?: string) {
        const rows = getVisualRows(item);
        const row = getRowAt(rows, path);
        if (!row || row.field !== 'disposition') return;

        let available = DISPOSITION_OPTIONS.find(d => d.value === dispKey);
        if (!available && dispKey) return;
        if (!available) {
            const usedKeys = row.subRows.map(sr => sr.field.split('.')[1]).filter(Boolean);
            available = DISPOSITION_OPTIONS.find(d => !usedKeys.includes(d.value));
        }
        if (!available) return;

        const newSubRow: VisualRow = {
            field: `disposition.${available.value}`,
            operator: 'equal',
            value: 'true',
            patternFlags: '',
            subRows: [],
        };
        row.subRows.push(newSubRow);
        applyRows(item, rows);
    }

    function removeDispositionMatch(item: StreamItem, path: number[], subIndex: number) {
        const rows = getVisualRows(item);
        const row = getRowAt(rows, path);
        if (!row || row.field !== 'disposition') return;
        row.subRows.splice(subIndex, 1);
        applyRows(item, rows);
    }

    function updateDispositionValueMatch(item: StreamItem, path: number[], subIndex: number, value: boolean) {
        const rows = getVisualRows(item);
        const row = getRowAt(rows, path);
        if (!row || row.field !== 'disposition') return;
        const sr = row.subRows[subIndex];
        if (!sr) return;
        sr.value = value ? 'true' : 'false';
        applyRows(item, rows);
    }

    function rowKey(itemId: string, rowIdx: number): string {
        return itemId + '-row-' + rowIdx;
    }

    // ─── Return ─────────────────────────────────────────────────

    return {
        getVisualRows,
        applyRows,
        getAvailableOperators,
        isNestedOp,
        isTerminalOp,
        addRow,
        removeRow,
        updateRowField,
        updateRowOp,
        updateRowValue,
        togglePatternFlag,
        addSubRow,
        removeSubRow,
        addDispositionMatch: addDisposition,
        removeDispositionMatch,
        updateDispositionValueMatch,
        rowKey,
    };
}
