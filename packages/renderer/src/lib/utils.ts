import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}

/**
 * Safely attempt to parse a RegExp from a string. Returns `null` on invalid syntax.
 * If flags are provided, they are passed as the second argument to `new RegExp`.
 */
export function tryParseRegex(pattern: string, flags?: string): RegExp | null {
    try {
        return new RegExp(pattern, flags);
    } catch {
        return null;
    }
}

/**
 * Returns `true` if the given string is a valid RegExp pattern (with optional flags).
 */
export function isValidRegex(pattern: string, flags?: string): boolean {
    return tryParseRegex(pattern, flags) !== null;
}

/**
 * Returns `true` if the season name is a generic auto-generated name like "Season N".
 * TMDB provides "Season 1", "Season 2", etc. as defaults when a season has no unique name.
 * These are redundant since we already know the season number.
 *
 * Returns `false` for unique names like "Specials", "The Final Season", "Volume 2", etc.
 */
export function isGenericSeasonName(name: string): boolean {
    return /^season \d+$/i.test(name.trim());
}
