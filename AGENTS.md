# AGENTS.md

## Ground rules (always)
- Be conservative, explicit, and boring.
- When unsure, ask; don’t guess.
- Make minimal, targeted changes; avoid refactors unless requested/necessary.
- Preserve existing structure, conventions, and tooling.
- Don’t add dependencies without strong justification.

## TypeScript
- Write strict, idiomatic TS; follow the repo’s tsconfig and lint rules.
- No `any` (use `unknown`, generics, or proper types).
- Prefer `interface` for public shapes; `type` for unions/helpers.
- Prefer immutability (`readonly`, `ReadonlyArray`) where practical.
- Narrow with type guards; avoid assertions and `!` except as a last resort.
- Prefer exhaustive handling (`never` checks) for unions.
- Treat caught errors as `unknown` and narrow before use.
- Prefer a single source of truth.

## Node.js
- Target the repo’s supported Node LTS (don’t assume versions; check config/docs).
- Prefer `async/await`; never swallow rejections.
- Avoid module top-level side effects (I/O, network, reading env, global mutations) unless explicitly intended.
- Env vars: validate centrally; read at runtime (not import-time); don’t mutate in app code (tests only with scoped setup/teardown).
- Error handling: rethrow with context; preserve `cause` when available; don’t throw strings.
- Library code should not log; CLIs may log intentionally with consistent exit codes.
- Use `npm` to install dependencies and run scripts; don’t use `yarn` or `pnpm` directly. You can use `npx` for one-off scripts if needed.

## Testing (Vitest)
- New logic requires tests unless truly trivial (types-only, re-exports, comments/formatting).
- Tests must be deterministic and isolated; avoid shared mutable state.
- Prefer behavioral tests; mock sparingly.
- No committed `.only`/`.skip` (unless explicitly justified).
- Bug fixes must include a regression test.
- Avoid snapshots unless they add clear value and are stable.
- Unit tests mirror source structure: `tests/unit/<area>/<file>.test.ts` for `packages/<area>/src/<file>.ts`. Tests that must re-implement production logic (e.g. `muxing-concurrency.test.ts` mirrors the store's concurrency expression) say so in a comment and assert the real file's text where it matters.

### Integration tests (Playwright)
- `npm run test:integration` drives the **packaged** Electron app from `dist/` (not a dev server) and is a required gate: it produces the documentation screenshots. Run `npm run compile` first — `findExecutable()` in `helpers/fixtures.ts` throws a clear error if no unpacked build exists.
- The suite runs at `workers: 1`, `fullyParallel: false`, because the Electron instance and its appdata are shared and several specs depend on ordered UI interaction. The `app` fixture is nevertheless **test-scoped** (a fresh Electron per test) to keep IPC dialog stubs isolated — do not "parallelise" the config, and do not hoist the fixture to worker scope.
- Test isolation relies on env vars the app reads at startup: `MUXBOX_USER_DATA` redirects appdata to `tests/integration/appdata` (see `packages/entry-point.mjs`) and `PLAYWRIGHT_TEST=true` enables the crash handlers. Chromium is launched with `--force-device-scale-factor=1`; Electron ignores `page.screenshot({scale:'css'})`, so a 150% display would otherwise yield 2880x1620 captures.
- The media corpus under `tests/integration/corpus/` is **generated, never committed**. `generate-corpus.ts` synthesizes it with the FFmpeg bundled by `node-av`, in two phases (expensive base encodes once, then `-c copy` remux per episode), gated by a `.stamp` version. Bump `STAMP_VERSION` to force a rebuild.
- `global-teardown.ts` encodes temporary PNGs to 1920x1080 AVIF and **replaces `media/screenshots/` wholesale** — but only when the whole suite passes. A failing run writes `RUN_FAILED_MARKER` and keeps `media/screenshots-temporary/` plus `tests/integration/appdata/` for inspection. Never promote screenshots by hand.
- Captures must be exactly 1920x1080. `helpers/screenshot.ts` throws on any other size, because a docked DevTools pane would otherwise be stretched to fit and silently ship distorted docs images.
- Adding a screenshot means adding the `light/` and `dark/` pair and a `<picture>` element in the relevant `docs/*.md` page, then regenerating.
- CI runs the full suite on Windows x64 and a single-spec smoke on Windows ARM; macOS and Linux do not run integration tests.

## Style, docs, and security
- Follow existing formatting/lint; keep functions small and readable.
- Prefer named exports.
- Update docs/comments when behavior changes (comments explain “why”, not “what”).
- Never log secrets; validate/sanitize external inputs (paths/URLs/user data).
- Dependency adds must be justified (need, alternatives, maintenance/license/security impact).
- `CHANGELOG.md` is user-facing only: record features, behavior changes, and bug fixes, and omit CI, release-pipeline, and build-script work. Keep a Changelog format; add user-facing changes to the `## [Unreleased]` section as you land them, then rename it at release time.

## MUST NOT
- Change public APIs or introduce breaking changes without explicit instruction.
- Perform stylistic rewrites or micro-optimizations.

## Verify before committing
- Typecheck + lint + tests pass.
- New behavior has coverage (including failure paths); no unintended snapshot changes.
- No unnecessary diff churn; no accidental top-level side effects; env usage is validated and intentional.

## Backend packages (node-av, mediainfo, mkvmerge, IPC)

### Dependency boundaries
- `@app/muxer` is the sole owner of `node-av` multiplexing logic. Do not import `node-av` directly outside `@app/muxer` and `@app/preload`.
- The preload (`@app/preload`) is the only bridge between the renderer and all backend packages. The renderer must never import `@app/muxer`, `node-av`, `@app/mediainfo`, or `@app/mkvtoolnix` directly.
- `mkvmerge`, `mkvinfo`, and `opusenc` are bundled per-platform binaries fetched at build/CI time by `scripts/fetch-external-tools.mjs` (`npm run fetch:tools`) into `buildResources/bin/<platform>-<arch>/` and shipped via `extraResources` (never commit them). Resolve them with `resolveTool()` from `@app/mkvtoolnix` before spawning — it falls back to a bare `PATH` lookup when nothing is bundled. Spawn with `child_process.spawn` only from `@app/mkvtoolnix` and `@app/muxer/src/encoders` respectively.

### FFmpeg Demuxer concurrency
- `Demuxer.open()` deadlocks when several calls happen simultaneously. Always serialize opens through the `acquireFfmpegSemaphore()` / `releaseFfmpegSemaphore()` pair implemented in both `@app/muxer` and `@app/preload`.
- Any new code that opens a node-av Demuxer must use this semaphore; never open demuxers in parallel.

### Packet reading: sync vs async
- File-based demuxers use `demuxer.packetsSync()` (synchronous iteration).
- Pipe/stream-based demuxers (e.g., preprocessed Opus from opusenc) must use `demuxer.packets()` (async iteration with `await`). Using `packetsSync()` on a pipe demuxer causes premature EOF.
- Reuse `DemuxPacketReader` from `merge-streams.ts` rather than writing raw packet loops.

### Resource cleanup
- `EpisodeMuxer` implements the `AsyncDisposable` protocol. Always use `await using muxer = await EpisodeMuxer.init(...)` or call `muxer[Symbol.asyncDispose]()` in a `finally` block.
- New classes that own native resources (Demuxer references, temp files, child processes) should also implement `AsyncDisposable`.
- **Every packet popped off the heap must be freed exactly once.** `Packet` is a native handle; leaking one per packet exhausts memory on large files. Free on every exit path — dropped, filtered, and cancelled alike — and wrap writes in `try { … } finally { packet.free(); }` so a throwing write cannot skip the free. Read `packet.dts`/`pts` *before* freeing (`recordPacket` needs them).

### Hot-path performance
- Per-packet `BigInt` maths is a real cost: precompute loop-invariant values (e.g. delay in stream time-base units) once per stream into the write-context map, not per packet.
- Node 23 exposes `node:worker_threads.Atomics` and `SharedArrayBuffer`. `DemuxPacketReader` uses `Atomics.wait()` on an `Int32Array` to emulate a blocking read inside sync iteration; do not "optimize" that into a busy loop.

### MediaInfo
- `mediainfo.js` is optional — wrap all calls in try/catch and fall back to FFmpeg metadata on failure.
- Language priority for stream matching: BCP-47 (MediaInfo `Language` with length > 2) > ISO 639-2 (`Language_String3`) > FFmpeg metadata.
- The WASM blob has ~1–2s startup latency; avoid calling per-stream in hot paths.

### Stream selection
- The `Selector<T>` type family defines recursive matching with operators: `equal`, `not`, `allOf`, `anyOf`, `oneOf`, `greaterThan`, `lessThan`, `pattern`, `contains`, `startsWith`, `endsWith`.
- `RegExp` objects in match patterns are not JSON-serializable. Convert to strings before IPC (`val instanceof RegExp ? val.toString() : val`) and restore with `tryParseRegex()` at the boundary.
- New selector properties must be added to the switch statement in `BaseSelector.select()` and to the corresponding `*StreamMatch` interface in `episode/types.ts`.

### Simulator / muxer parity
- The queue's preview model is built by `buildEpisodeModel()` in `packages/muxer/src/episode/simulator.ts`. It must agree with what `EpisodeMuxer` actually does, or the queue lies about the output.
- Queue-level per-track overrides are applied by `applyOverridesToModel()`, called separately from `buildEpisodeModel()` because the caller has the episode ID. Overrides mutate comparisons in place; `buildEpisodeModel()` deliberately ignores its `_queueOverrides` parameter. Do not fold override application back into the model builder.
- Overrides are keyed `"demuxerMapKey:originalIndex"` and only apply to subtitles for `compress`; an explicit `false` must be honoured, so compare against `undefined`, never truthiness.

### Cross-boundary duplicated allowlists
- Some constants must exist on both sides of the IPC boundary and cannot be shared, because the renderer may not import backend packages. Each duplicate is a drift risk — when you change one, change the other and extend the matching test.
  - Text-subtitle codec allowlist: `isTextBasedSubtitleTrack()` in `@app/mkvtoolnix` and `isTextSubtitleCodec()` / `TEXT_SUBTITLE_CODEC_VAR_NAMES` in `packages/renderer/src/lib/stream-match.ts`. Bitmap subtitles (PGS, VoBSub, DVB, XSUB) are excluded on purpose.
  - Disposition flags: `ALL_DISPOSITIONS` in `packages/muxer/src/sorter/index.ts` uses `AV_DISPOSITION_*` from `node-av`, while the renderer hardcodes the same values as decimal strings in `DISPOSITION_OPTIONS` (`packages/renderer/src/components/source/config/disposition-options.ts`). The numeric values are the contract; changing one without the other silently mislabels flags. `DISPOSITION_SORT_PRIORITY` in the simulator is a third, partial copy.

### Context bridge (IPC)
- Functions are exposed to the renderer via `contextBridge.exposeInMainWorld(btoa(name), fn)`. New exported functions in `@app/preload` automatically become available.
- `Map` objects are not structured-cloneable — serialize with `Object.fromEntries(map)` before crossing the bridge.
- `AbortSignal` is not structured-cloneable — use a string `processId` token and maintain `AbortController` instances inside the preload layer instead.

---

## Frontend / Renderer (Vue, Tailwind, component libraries)

### Vue 3 conventions
- All components use `<script setup lang="ts">` with Composition API. No Options API.
- Use `defineOptions({ name: 'ComponentName' })` for explicit component naming.
- Type props with `defineProps<Interface>()` and `withDefaults`. Type emits with `defineEmits<{ (e: 'event', payload: Type): void }>()`.

### Package layering
- The renderer imports backend functions exclusively from `@app/preload` (or accesses them via `window` through the context bridge).
- Import types from `@app/preload` for domain objects: `Episode`, `MuxSnapshot`, `ProjectData`, `StreamInfo`, `TrackComparison`, etc.
- Import TMDB types from `@app/tmdb` for type-only usage.
- Never import `@app/muxer`, `node-av`, or `@app/mediainfo` directly.

### UI components (Reka UI)
- Use Reka UI (`reka-ui`) for all interactive primitives: dialogs, tooltips, tabs, switches,
  checkboxes, selects, comboboxes, number inputs, labels, separators, hover cards, accordions,
  collapsibles, progress bars, sliders, toasts, popovers, dropdown menus, and context menus.
- Do not hand-roll interactive, stateful, or accessible components unless Reka UI does not
  provide an equivalent. If you must build custom, ensure it follows WAI-ARIA authoring practices.
- Import Reka components directly: `import { DialogRoot, DialogContent } from 'reka-ui'`.
  Do not wrap them in local abstractions unless adding significant project-specific logic.
- Style Reka components using Tailwind `data-*` variants:
  `data-[state=active]:`, `data-[state=checked]:`, `data-[disabled]:`, `data-[highlighted]:`, etc.
- Do not use `class-variance-authority` (CVA). Reka handles variant state via data attributes;
  style those directly with Tailwind utilities.
- For presentational wrappers (buttons, cards, badges, text inputs, textareas) that have no
  Reka equivalent, keep them minimal — styled native elements, no CVA.

### Tailwind CSS v4
- Use `@import "tailwindcss"` — not `@tailwind` directives.
- Theme customization goes in the `@theme inline {}` block in `style.css`, not in a `tailwind.config.js`.
- Maintain OKLCH color space for all CSS custom properties.
- Dark mode uses `.dark` class variant via `@custom-variant dark (&:is(.dark *));`.
- Prefer CSS animations over JS-based animation libraries. Use Vue `<Transition>` or plain
  `@keyframes` in the component's scoped `<style>` block; no animation library is installed.

### Icons
- Use Lucide Vue with named imports: `import { IconName } from '@lucide/vue'`. These are tree-shakeable.
- Prefer named Lucide components over `<i>` tags or inline SVGs.
- Standard icon sizes: `h-4 w-4` (inline), `h-5 w-5` (section), `h-7 w-7` (icon buttons).

### State management
- Pinia stores use the Setup/Composable syntax: `defineStore('name', () => { ... })`.
- Undo/redo for project state is managed by `travels`, not Pinia history. Reuse `useProjectStore` patterns.
- Store subscriptions use `travels.subscribe()` to react to state changes.
- New stores with undo/redo requirements should use `travels`, not implement custom history.

### Drag and drop
- Use `@vue-dnd-kit/core` with `<DnDProvider>` for all drag-and-drop features. Do not use native HTML5 DnD or alternative libraries.

### Serialization across the context bridge
- `RegExp` objects are not JSON-serializable. Use `JSON.stringify(val, replacer)` with a RegExp–to–string replacer before sending to preload, and `tryParseRegex()` to restore.
- The renderer must never send `RegExp` instances directly to preload functions.
- Follow the `toIPCSerializable()` pattern from `ProjectView.vue` for complex project data.

### Editor
- Monaco Editor is configured via `MonacoEnvironment.getWorkerUrl` in `main.ts`. Keep the worker URL setup in sync when upgrading Monaco.
- The `@guolao/vue-monaco-editor` wrapper is used for JSON editing only.

### Autosave and keyboard shortcuts
- Project changes auto-save after a 500ms debounce via `scheduleSave()`. Flush pending saves on `onUnmounted`.
- Standard shortcuts: `Ctrl+Z` / `Cmd+Z` for undo, `Ctrl+Shift+Z` / `Cmd+Shift+Z` or `Ctrl+Y` / `Cmd+Y` for redo.
- New views with editable state should adopt the same debounced-save pattern.

### Theme syncing
- The `.dark` class on `<html>` is the single source of truth for theming. `applyTheme()` in the
  settings store sets it; never toggle it ad hoc from a component.
- Monaco's theme is global and does not follow the class automatically. Register each editor's
  setter with `registerMonacoThemeSetter()` and release it with `unregisterMonacoThemeSetter()` on
  unmount; `monaco-theme.ts` observes the class and re-themes every live editor. Do not call
  `monaco.editor.setTheme` directly from a component.

---

## CI/CD

### Workflow architecture
- `ci.yml` runs on pushes to `main` and on pull requests (path-filtered for docs/IDE files). It typechecks, lints, and calls the reusable `compile-and-test.yml` matrix: Windows x64, Windows arm64 (`windows-11-arm`, with a one-spec integration smoke), macOS arm64, macOS Intel (`macos-15-intel`), and Linux x64.
- Releases are tag-driven: pushing a `v*` tag triggers `release.yml`, which reuses `compile-and-test.yml` and then publishes a GitHub Release with `SHA256SUMS.txt`. `nightly.yml` (weekly cron, skipped when nothing changed since the last `v*` tag) calls `release.yml` via `workflow_call` — pushes made with the default `GITHUB_TOKEN` never trigger other workflows, so the nightly chain must be explicit.
- Do not add direct push/PR triggers to `compile-and-test.yml` or `release.yml`; entry points are `ci.yml`, tag pushes, and `nightly.yml`.
- Compile jobs run `node scripts/fetch-external-tools.mjs --arch <arch>` before building so each artifact carries tools for exactly its architecture.

### Build and versioning
- `npm run compile -- --<os> --<arch> -p never` runs the Vite builds and then electron-builder; CI always passes explicit arch flags so every artifact is single-arch.
- Versions come from tags: `v1.2.3` (stable), `v1.2.3-beta.N` (beta), `v1.2.3-nightly.<UTC timestamp>` (nightly). The prerelease part of the version selects the electron-builder channel file (`latest.yml`, `beta.yml`, or `nightly.yml`), and releases with a prerelease part are marked `--prerelease`.
- Playwright relies on pre-installed browsers on GitHub runners (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`). For local E2E tests, run `npx playwright install` first.

### Package file inclusion
- Every `@app/*` workspace package must list its production files in the `"files"` key of its `package.json`. Default: `["dist/**", "package.json"]`. Source and test files are excluded automatically.
- `electron-builder.mjs` reads these lists to determine what goes into the production build. Adding a new workspace package means verifying its file inclusion pattern.

### Dependency management
- Bundled CLI tools are fetched (never committed) by `scripts/fetch-external-tools.mjs` with pinned versions and checksums, staged from `buildResources/bin` via `extraResources`, resolved by `resolveTool()` with a `PATH` fallback, and shipped with license texts in `licenses/` beside each architecture's binaries.
- Native addons (`node-av`) must match the target Electron/Node.js version (see `packages/electron-versions`). A version mismatch typically causes runtime segmentation faults, not build errors.
- `node-av` is patched at `postinstall` by `patch-package` (see `patches/README.md`). The patch memoises `FormatContext.streams` and removes a per-packet array allocation in the write paths; it is worth roughly a 4x mux speedup and is load-bearing, not an optimisation to "clean up".
- Bumping `node-av` will make `postinstall` fail loudly if upstream changed. That is intended. Re-apply the edits in `node_modules/node-av/dist/…`, delete the stale `patches/node-av+<old>.patch`, regenerate with `npx patch-package node-av`, and update `patches/README.md`. Never silence the failure or drop the patch to make install pass.
- macOS stages `mkvmerge`/`mkvinfo` from the official MKVToolNix DMG (Homebrew has no Intel-mac bottle) plus a Homebrew `opus-tools` bottle; Linux and Windows use their own sources. `resolveTool()` hides the difference — do not reintroduce platform checks at the call site.
- Before adding any npm dependency, confirm it works with Electron 42 / Node 23 and is available as ESM.

### Releases
- `release.yml` derives version/channel from the tag (or workflow inputs), runs the full compile matrix, merges the per-job update metadata with `scripts/merge-update-files.mjs` (electron-updater picks its architecture from the `files[]` urls), verifies the expected channel file exists, writes `SHA256SUMS.txt`, and creates the release with `gh release create` (`--prerelease` for beta/nightly). Release URL pattern: `https://github.com/BoatsMcGee/MuxBox/releases/tag/v<version>`.
- Builds are never code-signed: macOS uses `identity: null` / `notarize: false`, macOS updates are notify-only (see `AutoUpdater.ts`), and Windows/Linux use electron-updater's `checkForUpdatesAndNotify`.
- Build provenance attestation is generated for all compiled installers (`actions/attest-build-provenance`).
