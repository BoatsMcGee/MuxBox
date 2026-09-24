declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    // Standard Vue SFC shim. `any` is required so component instance members
    // (e.g. `vm.flush()` in tests) remain accessible under plain tsc.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const component: DefineComponent<Record<string, never>, Record<string, never>, any>;
    export default component;
}