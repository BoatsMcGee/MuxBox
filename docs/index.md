# MuxBox User Documentation

Guides for the core MuxBox screens. Each page pairs a short, task-oriented
description with real application screenshots in both themes — every image
below is generated automatically by the integration test suite, so the
screenshots always match the current UI.

## Contents

| Guide | Covers | Screenshots |
| --- | --- | --- |
| [Home](home.md) | Landing page, project list, creating and deleting projects | 1 |
| [Project](project.md) | Project Settings, output directory, tags, rename template, TMDB series & seasons, sources | 9 |
| [Episode Queue](episode-queue.md) | Episode rows, tracks, container, chapters, tooltips | 7 |
| [Source](source.md) | Add/Edit Source, match pattern, capture groups, metadata & chapters copying | 8 |
| [Stream Match Preview](stream-match-preview.md) | Stream Configuration builder, filters, modify & preprocess rules, preview states | 15 |
| [Settings](settings.md) | TMDB token, theme, default rename template, multiplexer method, concurrency | 1 |

## Screenshots

Every screenshot is captured at 1920×1080 during `npm run test:integration`
(Windows) and stored as AVIF in two variants:

- `media/screenshots/dark/…` — dark theme
- `media/screenshots/light/…` — light theme

The images on these pages adapt to your viewer's theme automatically
(`<picture>` with `prefers-color-scheme`); both files are always embedded.

Screenshots are only promoted into `media/screenshots/` when the **entire**
integration suite passes — a failing run keeps its temporary captures out of
the docs tree. The test media corpus is generated on demand by FFmpeg and is
never committed.

To regenerate everything after a UI change:

```sh
npm run test:integration
```
