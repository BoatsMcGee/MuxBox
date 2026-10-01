import { describe, it, expect } from 'vitest';
import { mergeTrackModifier } from '../../../packages/muxer/src/selector/index.js';

describe('mergeTrackModifier — compress', () => {
    it('applies an explicit true override', () => {
        expect(mergeTrackModifier({}, { compress: true }).compress).toBe(true);
    });

    it('applies an explicit false override (must not be dropped)', () => {
        // Regression guard: a truthiness check here would silently drop the
        // "user turned compression off" case and re-enable it via the default.
        expect(mergeTrackModifier({ compress: true }, { compress: false }).compress).toBe(false);
    });

    it('leaves the base value untouched when the override is undefined', () => {
        expect(mergeTrackModifier({ compress: false }, {}).compress).toBe(false);
        expect(mergeTrackModifier({}, {}).compress).toBeUndefined();
    });

    it('preserves other fields while merging compress', () => {
        const merged = mergeTrackModifier(
            { language: 'eng', delay: 100 },
            { title: 'Full', compress: true },
        );
        expect(merged).toEqual({ language: 'eng', delay: 100, title: 'Full', compress: true });
    });

    it('does not mutate the base object', () => {
        const base = { language: 'eng' };
        mergeTrackModifier(base, { compress: true });
        expect(base).toEqual({ language: 'eng' });
    });
});
