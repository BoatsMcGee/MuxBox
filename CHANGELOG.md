# Changelog

All notable user-facing changes to MuxBox are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions are published from git tags (`v0.0.1`, `v0.0.1-beta.1`,
`v0.0.1-nightly.<timestamp>`), so the heading below matches the release tag.

Only changes that affect the application are listed. Build, CI, and release
pipeline work is intentionally excluded — see the note at the end of each
release.

## [Unreleased]

Nothing yet.

## [0.0.2] — 2026-10-01

Everything in this section is the delta since the
`v0.0.1-nightly.20260930105508` nightly, which is the most recent published
build.

### Added

- **A default rename template in Settings.** New projects no longer always
  start from the hard-coded `{Series} - S##E## - {Name}` template. Settings now
  has a **Default Rename Template** section using the same editor as the
  project page — example preview plus per-field prefix, suffix, and padding —
  and every project created from then on copies that template and its field
  settings when it is created. Projects you already have keep the template they
  are using, and changing the default later never rewrites them.
- **Subtitle zlib compression.** Subtitle modify rules now carry a
  **Compression** toggle, on by default, which compresses text subtitles with
  zlib while muxing. Available in the Stream Match Preview modify panel and as
  a per-track override in the Episode Queue track editor. Only text-based
  subtitles (SubRip, ASS/SSA, WebVTT) are eligible — bitmap formats such as PGS
  and VoBSub are already compressed and are skipped, because some players reject
  a Matroska `ContentEncodings` element on them. Compression is applied by
  `mkvmerge` after the mux finishes, so it affects only files you actually mux.
- **A visible reason when an episode is skipped.** The Episode Queue used to
  show a bare "skipped" state with no explanation; it now reports why, for
  example "Output file already exists and overwriting is disabled".
- **A proper indeterminate progress indicator while preprocessing.** The
  progress bar sweeps back and forth instead of showing a stuck or empty bar,
  since preprocessing has no meaningful percentage yet. The animation is
  disabled under `prefers-reduced-motion`, leaving a static indicator.
- **A loading spinner on the episode row itself.** Episodes still probing their
  sources show a spinner inside the `S##E##` badge.

### Changed

- **Queue status badges removed.** Each row carried a coloured status badge
  (pending, muxing, completed, error, skipped) that duplicated the progress bar
  directly beneath it. Rows are now quieter, the badge column is gone, and live
  state reads from the progress bar and the spinner.
- **Muxing throughput roughly 4× faster on large files.** A patch bundled with
  the app memoises node-av's `FormatContext.streams` getter and removes a
  per-packet array allocation in its write paths, which together accounted for
  79–92% of mux wall-clock at 100% CPU. A real run of an episode (806,312 packets)
  went from 3,120 s to 772 s. Per-packet delay maths was also hoisted out of
  the write loop, and packet lifetime was corrected. This also removed a
  throughput "cliff" that had appeared at around 100k packets in every run.
- **JSON editor now respects the app theme.** Monaco-backed JSON editors were
  dark-only; they now follow the app's light/dark theme, and stay in sync when
  the theme changes while an editor is open.
- **Pages no longer overflow when there is no content.** Empty and short views
  could spill past the viewport; the app now measures actual overflow and only
  renders a scrollbar track when the content genuinely overflows.
- **The JSON editor's diff modal is included in theming.** It shares the same
  theme bridge as the regular editor.

### Fixed

- **The Episode Queue "completed" counter could exceed the number of queued
  episodes.** Progress entries outlive the episodes they describe, so editing
  sources after a run left stale completions counted against a shorter queue.
  Counts are now scoped to the rows actually in the queue, excluding disabled
  rows and rows still probing their sources.
- **Episode Queue track overrides were ignored by the simulator.** Queue-level
  edits — title, language, dispositions, tags, delay, and now compression —
  did not show up in the simulated model, so the queue preview disagreed with
  what the real muxer would produce. The simulator now applies the same
  override logic as the muxer, and the override application was factored out so
  the two cannot drift.
- **The auto-updater threw on a `406` response.** GitHub's releases feed answers
  `404` while the repository has no releases and `406` when it has no published
  version. The `406` case was unhandled and surfaced as an error; it is now
  treated like `404` — nothing to update from.
- **Memory: packets were never freed after being written to the output.** The
  muxer now frees each packet in a `finally` block, so a write that throws
  cannot leak it either.
- **Muxing concurrency ignored an explicit setting.** A concurrency value of
  `0` was passed through instead of being treated as "unset", collapsing
  parallel muxing to a single episode. The setting now defaults to `undefined`
  and non-positive values fall back to the automatic
  `cpuCount - 1`, with the result clamped to the core count. Explicit positive
  values are still honoured.
- **Monaco theme changes were not pushed to already-open editors.** `monaco.editor.setTheme`
  is global, so the app now observes the theme class and re-themes every live
  editor, regular and diff alike, whenever the theme changes.

### Notes

- **macOS builds now bundle the official MKVToolNix binaries.** Previously
  macOS resolved `mkvmerge`/`mkvinfo` from Homebrew at runtime, which had no
  Intel-Mac bottle. Both Mac architectures now stage the official DMG binaries
  into the build, so `mkvmerge`, `mkvinfo`, and `opusenc` ship with every
  platform-specific artifact and nothing needs to be installed separately.
- The app patches `node-av` at install time via `patch-package`. If a
  `postinstall` step fails because upstream `node-av` changed, see
  [`patches/README.md`](patches/README.md) for how to regenerate the patch.
- CI, release pipeline, and external-tool fetch-script fixes are omitted from
  this changelog because they do not affect the shipped application. The
  same applies to integration-test harness fixes (screenshot dimensions,
  devtools drawer visibility) — those improve the generated docs images, not
  the app.

[Unreleased]: https://github.com/BoatsMcGee/MuxBox/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/BoatsMcGee/MuxBox/compare/v0.0.1-nightly.20260930105508...v0.0.2
