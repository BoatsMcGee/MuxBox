# MuxBox

![CI](https://github.com/BoatsMcGee/MuxBox/actions/workflows/ci.yml/badge.svg)
![Release](https://img.shields.io/github/v/release/BoatsMcGee/MuxBox)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

**Batch multiplexer with heuristics-based stream selection.**
Point MuxBox at a folder of episodes, match video/audio/subtitle streams with rules and capture groups, preview every decision, and mux an entire series in one queue.

> [!NOTE] LLM Disclosure
> With the exception of the core muxer, MuxBox is developed with the use of large language models (LLMs). This should go without saying but I maintain full responsibility of everything published.

## Features

* **Heuristic stream matching** — regex match patterns with capture groups,
  plus a Stream Configuration builder with codec, language, and custom
  expression filters. Preview every match before muxing.
* **Track modifications** — per-track delay, renaming, disabling, metadata and
  chapter copying, and Opus preprocessing/downmix through `opusenc`.
* **Episode queue** — inspect tracks, container info, and chapters per
  episode, then run the whole batch with live progress and full undo/redo.
* **TMDB integration** — link a series, browse seasons, fill episode names
  automatically, and apply a rename template with filename previews.
* **Bundled tools** — `mkvmerge`, `mkvinfo`, and `opusenc` ship inside every
  build; nothing to install separately.
* **Cross-platform** — Windows x64 and arm64, macOS Intel and Apple Silicon,
  Linux (AppImage, deb, rpm), plus a portable Windows build.
* **Auto-updates** — in-app updates on Windows and Linux; macOS is notified
  with a link to the release page (unsigned builds cannot self-update).
* **Dark and light themes**, Monaco-backed JSON editing, and raw stream info
  inspection.

### Planned Features and Changes

MuxBox is for the most part feature-complete for my personal use, but is in need of improvements, particularly to the Episode Queue, general stability, and quality-of-life improvements.

* Rearchitect Episode Queue
* Improve Stream Match Selector feedback (track indicates which Stream Configuration picked it)
* Prevent multiple Stream Configurations from matching the same track (produces unexpected results)
* Add a way to export, import, and share Stream Configurations
* Remove or workaround 10-event-listener limit (Prevents more than 10 episodes from being muxed at once)
* Rewrite all documentation by hand
* Add FAQ
* Add Guides
* Add examples
* Add documentation website
* Add Stream Configuration "marketplace"

## Quick start

> [!IMPORTANT]
> MuxBox releases are **not code-signed**. Windows SmartScreen and macOS
> Gatekeeper will warn on first launch — that is expected. See
> [`docs/install.md`](docs/install.md) for the one-click bypasses, checksum
> verification, and portable-vs-installer guidance.

### Download and run

Grab a build from the
[Releases page](https://github.com/BoatsMcGee/MuxBox/releases) and verify it
against `SHA256SUMS.txt` on the same page:

| Platform | Installer | Alternative |
| --- | --- | --- |
| Windows x64 | `MuxBox-<version>-win-x64.exe` (NSIS) | `…-win-x64-portable.exe`, no install |
| Windows arm64 | `MuxBox-<version>-win-arm64.exe` (NSIS) | `…-win-x64-portable.exe` runs under emulation |
| macOS, Apple Silicon | `MuxBox-<version>-mac-arm64.dmg` | `…-mac-arm64.zip` |
| macOS, Intel | `MuxBox-<version>-mac-x64.dmg` | `…-mac-x64.zip` |
| Linux x64 | `MuxBox-<version>-linux-x64.AppImage` | `…-linux-x64.deb` or `.rpm` |

`mkvmerge` and `opusenc` are bundled — no extra software is required.

### Run from source

Requires **Node.js 23 or newer** (see [`.node-version`](.node-version)).

```sh
npm install
npm start                 # development mode

npm run fetch:tools       # optional: bundle mkvmerge/opusenc for local runs
                          # (without it, tools are resolved from PATH)
npm run compile -- --win --x64   # produce installers for your platform
```

To test, run `npm run test:unit`. For integration tests, run `npm run test:integration`.

### Releases and updates

* Versions come from git tags: `v1.2.3` (stable), `v1.2.3-beta.N` (beta), and
  a weekly `v…-nightly.<timestamp>` prerelease — all published by CI
  ([`ci.yml`](.github/workflows/ci.yml), [`release.yml`](.github/workflows/release.yml),
  [`nightly.yml`](.github/workflows/nightly.yml)).
* Every release ships `SHA256SUMS.txt` and per-platform installers plus the
  portable Windows build.
* Windows and Linux installs update themselves in-app; macOS prompts and opens
  the release page, because self-updating unsigned macOS apps is not possible.
* User-facing changes are listed in [`CHANGELOG.md`](CHANGELOG.md).

## Usage documentation

Full task-oriented guides with screenshots live in [`docs/`](docs/index.md):

| Guide | Covers |
| --- | --- |
| [Home](docs/home.md) | Landing page, project list, creating and deleting projects |
| [Project](docs/project.md) | Project settings, output directory, tags, rename template, TMDB series & seasons |
| [Episode Queue](docs/episode-queue.md) | Episode rows, tracks, container, chapters, tooltips |
| [Source](docs/source.md) | Add/edit source, match patterns, capture groups, metadata & chapters |
| [Stream Match Preview](docs/stream-match-preview.md) | Stream Configuration builder, filters, modify & preprocess rules |
| [Settings](docs/settings.md) | TMDB token, theme, default rename template, multiplexer method, concurrency |

## Screenshots

Every screenshot adapts to your browser's preferred theme and is generated by the integration test suite, so it's updated automatically. The full set can be found in [`media/screenshots`](media/screenshots) and inside the [usage docs](docs/index.md).

|||
|---|---|
| <picture><source media="(prefers-color-scheme: dark)" srcset="media/screenshots/dark/homepage.avif"><img src="media/screenshots/light/homepage.avif" alt="MuxBox home page with the project list"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="media/screenshots/dark/settings.avif"><img src="media/screenshots/light/settings.avif" alt="Settings: TMDB token, theme, multiplexer, concurrency"></picture> |
| <picture><source media="(prefers-color-scheme: dark)" srcset="media/screenshots/dark/project/main.avif"><img src="media/screenshots/light/project/main.avif" alt="Project page with sources and output settings"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="media/screenshots/dark/project/queue-tracks.avif"><img src="media/screenshots/light/project/queue-tracks.avif" alt="Episode queue track configuration"></picture> |
| <picture><source media="(prefers-color-scheme: dark)" srcset="media/screenshots/dark/project/series-search.avif"><img src="media/screenshots/light/project/series-search.avif" alt="TMDB series search"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="media/screenshots/dark/source/add.avif"><img src="media/screenshots/light/source/add.avif" alt="Add source dialog with match pattern"></picture> |
| <picture><source media="(prefers-color-scheme: dark)" srcset="media/screenshots/dark/source/edit.avif"><img src="media/screenshots/light/source/edit.avif" alt="Edit source view"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="media/screenshots/dark/source/match-basic.avif"><img src="media/screenshots/light/source/match-basic.avif" alt="Stream match preview with capture groups"></picture> |

## Acknowledgements

* [MKVToolNix](https://mkvtoolnix.download/) by Moritz Bunkus
  ([source on Codeberg](https://codeberg.org/mbunkus/mkvtoolnix)) — GPL-2.0-or-later.
* [opus-tools](https://opus-codec.org/downloads/) and the Xiph.Org Foundation
  — BSD-2-Clause.
* [node-av](https://github.com/seydx/node-av) by seydx — MIT, with bundled
  FFmpeg.
* [Electron](https://www.electronjs.org/), [electron-builder](https://www.electron.build/),
  and [electron-updater](https://www.electron.build/auto-update).
* The [Vite Electron Builder](https://github.com/cawa-93/vite-electron-builder)
  template by cawa-93 and community, on which this repository started.
* Binary packaging from the official MKVToolNix releases,
  [Homebrew](https://brew.sh/), and [MSYS2](https://www.msys2.org/).

Bundled third-party components and their licenses are listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE) © Boats McGee 2026.
