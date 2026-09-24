/**
 * Visual row helpers for the stream match builder.
 * Converts between match selector objects and visual editor rows.
 */
import type { FieldDef, VisualRow } from '@/components/source/types/stream-match-types';
import {
    operatorOptions,
    isTerminalOp,
} from '@/components/source/config/operator-options';
import { resolveCodecId, formatValue } from '@/components/source/utils/codec-mapping';

// ─── Visual Row helpers ─────────────────────────────────────────

export function emptyRow(field: string): VisualRow {
    return { field, operator: 'equal', value: '', patternFlags: '', subRows: [] };
}

export function deepCopyRows(rows: VisualRow[]): VisualRow[] {
    return rows.map((r) => ({
        ...r,
        subRows: r.subRows.map((sr) => ({ ...sr, subRows: deepCopyRows(sr.subRows) })),
    }));
}

/**
 * Walk a nested row tree following an absolute path. The last element of
 * `path` is the target row; earlier elements descend through `subRows`.
 */
export function getRowAt(rows: VisualRow[], path: number[]): VisualRow | undefined {
    let current: VisualRow | undefined = rows[path[0]];
    for (let i = 1; i < path.length; i++) {
        if (!current) return undefined;
        current = current.subRows[path[i]];
    }
    return current;
}

export function makeRow(field: string, operator: string, value: string, subRows?: VisualRow[]): VisualRow {
    let patternFlags = '';
    let cleanValue = value;
    if (operator === 'pattern' && value.startsWith('/')) {
        const lastSlash = value.lastIndexOf('/');
        if (lastSlash > 1) {
            const flags = value.slice(lastSlash + 1);
            if (/^[gimsuy]*$/.test(flags)) {
                patternFlags = flags;
                cleanValue = value.slice(1, lastSlash);
            }
        }
    }
    return { field, operator, value: cleanValue, patternFlags, subRows: subRows ?? [] };
}

// ─── Parse / serialize match logic ──────────────────────────────

export function parseSelector(prop: string, selector: unknown): VisualRow[] {
    if (selector === null || selector === undefined) return [];

    // Special handling for disposition: it's an object mapping AVDisposition -> Selector<boolean>
    // e.g., { "1": { equal: true }, "32": { equal: false } }
    if (prop === 'disposition' && typeof selector === 'object' && !Array.isArray(selector)) {
        const obj = selector as Record<string, unknown>;
        const subRows: VisualRow[] = [];
        for (const [dispKey, dispSelector] of Object.entries(obj)) {
            const parsed = parseSelector(`disposition.${dispKey}`, dispSelector);
            subRows.push(...parsed);
        }
        // Return a single parent row with field='disposition' containing the sub-rows
        return [makeRow('disposition', 'allOf', '', subRows)];
    }

    if (typeof selector === 'object') {
        const obj = selector as Record<string, unknown>;
        let extraFlags = '';
        if ('patternFlags' in obj) {
            extraFlags = String(obj.patternFlags);
        }

        if ('not' in obj) {
            const inner = parseSelector(prop, obj.not);
            return [makeRow(prop, 'not', '', inner.length > 0 ? inner : [emptyRow(prop)])];
        }
        if ('allOf' in obj && Array.isArray(obj.allOf)) {
            const subRows = obj.allOf.flatMap((s: unknown) => parseSelector(prop, s));
            return [makeRow(prop, 'allOf', '', subRows.length > 0 ? subRows : [emptyRow(prop)])];
        }
        if ('anyOf' in obj && Array.isArray(obj.anyOf)) {
            const subRows = obj.anyOf.flatMap((s: unknown) => parseSelector(prop, s));
            return [makeRow(prop, 'anyOf', '', subRows.length > 0 ? subRows : [emptyRow(prop)])];
        }
        if ('oneOf' in obj && Array.isArray(obj.oneOf)) {
            const subRows = obj.oneOf.flatMap((s: unknown) => parseSelector(prop, s));
            return [makeRow(prop, 'oneOf', '', subRows.length > 0 ? subRows : [emptyRow(prop)])];
        }

        for (const op of operatorOptions) {
            if (isTerminalOp(op.value) && op.value in obj) {
                const row = makeRow(prop, op.value, formatValue({ field: prop, operator: op.value, value: '', patternFlags: '', subRows: [] } as VisualRow, obj[op.value]));
                if (extraFlags && op.value === 'pattern') {
                    row.patternFlags = extraFlags;
                }
                return [row];
            }
        }

        return [makeRow(prop, 'equal', String(selector))];
    }
    return [makeRow(prop, 'equal', String(selector))];
}

export function matchToVisualRows(match: Record<string, unknown>, fieldDefs: FieldDef[]): VisualRow[] {
    const rows: VisualRow[] = [];
    for (const field of fieldDefs) {
        const fieldVal = match[field.value];
        if (fieldVal === undefined || fieldVal === null) continue;

        // Special handling for disposition: ensure it creates a parent row with sub-rows
        // This is a fallback in case parseSelector doesn't handle it correctly
        if (field.value === 'disposition' && typeof fieldVal === 'object' && !Array.isArray(fieldVal)) {
            const obj = fieldVal as Record<string, unknown>;
            const subRows: VisualRow[] = [];
            for (const [dispKey, dispSelector] of Object.entries(obj)) {
                const parsed = parseSelector(`disposition.${dispKey}`, dispSelector);
                subRows.push(...parsed);
            }
            rows.push(makeRow('disposition', 'allOf', '', subRows));
        } else {
            const parsed = parseSelector(field.value, fieldVal);
            rows.push(...parsed);
        }
    }
    return rows;
}

export function rowToValue(row: VisualRow, fieldDefs: FieldDef[]): unknown {
    if (isTerminalOp(row.operator)) {
        if (!row.value && row.value !== '0') return undefined;
        const fd = fieldDefs.find((f) => f.value === row.field);
        let parsed: unknown = row.value;
        if (fd?.type === 'number') {
            const n = Number(row.value);
            if (!Number.isNaN(n)) parsed = n;
        }
        if (row.field === 'codec' && typeof parsed === 'string' && parsed !== '') {
            const resolved = resolveCodecId(parsed);
            if (resolved !== undefined) {
                parsed = resolved;
            }
        }
        // Special handling for disposition rows (field starts with "disposition.")
        if (row.field.startsWith('disposition.')) {
            const dispKey = row.field.split('.')[1];
            // Convert string 'true'/'false' to actual boolean for disposition selectors
            let dispositionValue = parsed;
            if (typeof parsed === 'string') {
                if (parsed === 'true') dispositionValue = true;
                else if (parsed === 'false') dispositionValue = false;
            }
            const sel: Record<string, unknown> = { [row.operator]: dispositionValue };
            if (row.operator === 'pattern' && row.patternFlags) {
                sel.patternFlags = row.patternFlags;
            }
            return { [dispKey]: sel };
        }
        const sel: Record<string, unknown> = { [row.operator]: parsed };
        if (row.operator === 'pattern' && row.patternFlags) {
            sel.patternFlags = row.patternFlags;
        }
        return sel;
    }

    if (row.operator === 'not') {
        const inner = row.subRows.map((sr) => rowToValue(sr, fieldDefs)).filter((v) => v !== undefined);
        if (inner.length === 0) return undefined;
        return { not: inner[0] };
    }

    if (row.operator === 'allOf' || row.operator === 'anyOf' || row.operator === 'oneOf') {
        const inner = row.subRows.map((sr) => rowToValue(sr, fieldDefs)).filter((v) => v !== undefined);
        if (inner.length === 0) return undefined;
        return { [row.operator]: inner };
    }

    return undefined;
}

// Helper to aggregate disposition rows into a single object
export function aggregateDispositionRows(rows: VisualRow[], fieldDefs: FieldDef[]): Record<string, unknown> | undefined {
    // Find the parent disposition row (field='disposition').
    const parentDispositionRow = rows.find(r => r.field === 'disposition');

    const allDispositionRows: VisualRow[] = [];

    // If there's a parent disposition row, collect from its subRows
    if (parentDispositionRow) {
        allDispositionRows.push(...parentDispositionRow.subRows.filter(r => r.field.startsWith('disposition.')));
    }

    // Also collect any top-level disposition rows (for backwards compatibility)
    allDispositionRows.push(...rows.filter(r => r.field.startsWith('disposition.') && r.field !== 'disposition'));

    if (allDispositionRows.length === 0) return undefined;

    const result: Record<string, unknown> = {};
    for (const row of allDispositionRows) {
        const value = rowToValue(row, fieldDefs);
        if (value && typeof value === 'object') {
            Object.assign(result, value);
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}
