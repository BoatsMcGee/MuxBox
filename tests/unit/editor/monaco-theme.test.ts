// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    monacoThemeName,
    registerMonacoThemeSetter,
    syncMonacoTheme,
    unregisterMonacoThemeSetter,
} from '@/lib/monaco-theme';

/**
 * The registry is module-level shared state, so each test drains it in
 * afterEach to stay independent of test ordering.
 */
describe('monaco-theme', () => {
    let setter: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        document.documentElement.classList.remove('dark');
        setter = vi.fn();
    });

    afterEach(() => {
        // Drain any registrations the test left behind. Unregistering is
        // clamped at zero, so extra calls are harmless.
        unregisterMonacoThemeSetter();
        unregisterMonacoThemeSetter();
        unregisterMonacoThemeSetter();
        document.documentElement.classList.remove('dark');
    });

    describe('monacoThemeName', () => {
        it("returns 'vs' in light mode", () => {
            expect(monacoThemeName()).toBe('vs');
        });

        it("returns 'vs-dark' when the .dark class is applied", () => {
            document.documentElement.classList.add('dark');
            expect(monacoThemeName()).toBe('vs-dark');
        });
    });

    describe('syncMonacoTheme', () => {
        it('is a no-op when no editor has registered', () => {
            expect(() => syncMonacoTheme()).not.toThrow();
        });
    });

    describe('registerMonacoThemeSetter', () => {
        it('applies the current theme immediately', () => {
            registerMonacoThemeSetter(setter);
            expect(setter).toHaveBeenCalledWith('vs');
        });

        it('applies the dark theme immediately when the app is dark', () => {
            document.documentElement.classList.add('dark');
            registerMonacoThemeSetter(setter);
            expect(setter).toHaveBeenCalledWith('vs-dark');
        });
    });

    describe('theme changes', () => {
        it('pushes a new theme when syncMonacoTheme runs after the class changes', () => {
            registerMonacoThemeSetter(setter);
            setter.mockClear();

            document.documentElement.classList.add('dark');
            syncMonacoTheme();

            expect(setter).toHaveBeenCalledWith('vs-dark');
        });

        it('pushes back to the light theme when dark mode is turned off', () => {
            document.documentElement.classList.add('dark');
            registerMonacoThemeSetter(setter);
            setter.mockClear();

            document.documentElement.classList.remove('dark');
            syncMonacoTheme();

            expect(setter).toHaveBeenCalledWith('vs');
        });

        it('stops pushing after the last editor unregisters', () => {
            registerMonacoThemeSetter(setter);
            unregisterMonacoThemeSetter();
            setter.mockClear();

            document.documentElement.classList.add('dark');
            syncMonacoTheme();

            expect(setter).not.toHaveBeenCalled();
        });

        it('ignores an unregister with no matching register', () => {
            expect(() => unregisterMonacoThemeSetter()).not.toThrow();

            registerMonacoThemeSetter(setter);
            setter.mockClear();

            syncMonacoTheme();
            expect(setter).toHaveBeenCalledWith('vs');
        });
    });

    describe('multiple simultaneous editors', () => {
        it('keeps theming while any editor is still mounted', () => {
            // Three editors hand over the same setter reference, as they do in
            // the real app (a stream-match row mounts one editor per section).
            registerMonacoThemeSetter(setter);
            registerMonacoThemeSetter(setter);
            registerMonacoThemeSetter(setter);
            setter.mockClear();

            unregisterMonacoThemeSetter();
            unregisterMonacoThemeSetter();

            document.documentElement.classList.add('dark');
            syncMonacoTheme();

            expect(setter).toHaveBeenCalledWith('vs-dark');
        });

        it('stops theming once the last editor unmounts', () => {
            registerMonacoThemeSetter(setter);
            registerMonacoThemeSetter(setter);
            registerMonacoThemeSetter(setter);

            unregisterMonacoThemeSetter();
            unregisterMonacoThemeSetter();
            unregisterMonacoThemeSetter();
            setter.mockClear();

            document.documentElement.classList.add('dark');
            syncMonacoTheme();

            expect(setter).not.toHaveBeenCalled();
        });
    });
});
