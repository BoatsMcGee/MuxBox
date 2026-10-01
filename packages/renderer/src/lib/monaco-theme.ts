/**
 * Bridges the app theme (a `.dark` class on <html>, applied by the settings
 * store) to Monaco's built-in themes.
 *
 * `monaco.editor.setTheme` is global, so a single call re-themes every live
 * editor — regular and diff alike. Editors register their setter once Monaco
 * has loaded, which keeps this module free of any Monaco import.
 */

export type MonacoThemeName = 'vs' | 'vs-dark';

/**
 * Registration count for the shared setter. Several editors can be mounted at
 * once (e.g. a stream-match row has one per section) and they all hand over the
 * same `monaco.editor.setTheme` reference, so identity alone cannot tell the
 * last unmount from the first — hence a count.
 */
let registrationCount = 0;
let themeSetter: ((theme: MonacoThemeName) => void) | null = null;

/** Resolve the current app theme to the matching Monaco built-in theme. */
export function monacoThemeName(): MonacoThemeName {
    return document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs';
}

/**
 * Watch the `.dark` class itself and keep Monaco in step.
 *
 * `applyTheme()` already calls syncMonacoTheme(), but the class is the real
 * source of truth — code that flips it directly (the screenshot harness does)
 * would otherwise leave live editors on the previous theme. Observing the class
 * means every path stays consistent.
 */
function observeThemeClass(): void {
    const root = document.documentElement;
    new MutationObserver(() => syncMonacoTheme()).observe(root, {
        attributes: true,
        attributeFilter: ['class'],
    });
}

observeThemeClass();

/** Push the current theme to every live editor. No-op before one registers. */
export function syncMonacoTheme(): void {
    themeSetter?.(monacoThemeName());
}

/**
 * Register the theme setter and immediately apply the current theme, so an
 * editor mounted after a theme change starts out correct.
 */
export function registerMonacoThemeSetter(setter: (theme: MonacoThemeName) => void): void {
    registrationCount++;
    themeSetter = setter;
    themeSetter(monacoThemeName());
}

/**
 * Release one registration. The setter stays active until the last editor
 * holding it unmounts. Safe to call more times than registered.
 */
export function unregisterMonacoThemeSetter(): void {
    if (registrationCount === 0) return;
    registrationCount--;
    if (registrationCount === 0) {
        themeSetter = null;
    }
}
