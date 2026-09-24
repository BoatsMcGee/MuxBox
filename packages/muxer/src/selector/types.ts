type BaseSelector<T> = SelectorEqual<T> | SelectorNot<T> | SelectorAllOf<T> | SelectorAnyOf<T> | SelectorOneOf<T>;

export type Selector<T> = T extends number
    ? BaseSelector<T> | GreaterThanSelector<T> | LessThanSelector<T>
    : T extends string
    ? BaseSelector<T> | PatternSelector | ContainsSelector<T> | StartsWithSelector<T> | EndsWithSelector<T>
    : BaseSelector<T>;

export interface SelectorEqual<T> {
    equal: T;
}

export interface SelectorNot<T> {
    not: Selector<T>;
}

export interface SelectorAllOf<T> {
    allOf: Selector<T>[];
}

export interface SelectorAnyOf<T> {
    anyOf: Selector<T>[];
}

export interface SelectorOneOf<T> {
    oneOf: Selector<T>[];
}

export interface GreaterThanSelector<T extends number> {
    greaterThan: T;
}

export interface LessThanSelector<T extends number> {
    lessThan: T;
}

export interface PatternSelector {
    pattern: RegExp;
}

export interface ContainsSelector<T extends string> {
    contains: T;
}

export interface StartsWithSelector<T extends string> {
    startsWith: T;
}

export interface EndsWithSelector<T extends string> {
    endsWith: T;
}