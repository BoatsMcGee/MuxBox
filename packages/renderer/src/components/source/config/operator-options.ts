import type { OperatorOption } from '@/components/source/types/stream-match-types';

// ─── Operator options ───────────────────────────────────────────

export const operatorOptions: OperatorOption[] = [
    { value: 'equal', label: 'Equals', appliesTo: ['string', 'number'] },
    { value: 'not', label: 'Not', appliesTo: ['string', 'number'] },
    { value: 'contains', label: 'Contains', appliesTo: ['string'] },
    { value: 'startsWith', label: 'Starts With', appliesTo: ['string'] },
    { value: 'endsWith', label: 'Ends With', appliesTo: ['string'] },
    { value: 'pattern', label: 'Regex Pattern', appliesTo: ['string'] },
    { value: 'greaterThan', label: 'Greater Than', appliesTo: ['number'] },
    { value: 'lessThan', label: 'Less Than', appliesTo: ['number'] },
    { value: 'allOf', label: 'All Of', appliesTo: ['string', 'number'] },
    { value: 'anyOf', label: 'Any Of', appliesTo: ['string', 'number'] },
    { value: 'oneOf', label: 'One Of', appliesTo: ['string', 'number'] },
];

const nestedOpSet = new Set(['not', 'allOf', 'anyOf', 'oneOf']);

export function isNestedOp(op: string): boolean {
    return nestedOpSet.has(op);
}

export function isTerminalOp(op: string): boolean {
    return !nestedOpSet.has(op);
}

// Boolean operator options for disposition switches
export const booleanOperatorOptions: OperatorOption[] = [
    { value: 'equal', label: 'Equals', appliesTo: ['boolean'] },
    { value: 'not', label: 'Not Equals', appliesTo: ['boolean'] },
];
