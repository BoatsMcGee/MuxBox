# Episode Queue

The **Episode Queue** is the right column of the [Project](project.md) page.
It shows one row per episode — derived from every source's parsed filenames —
and lets you inspect and adjust exactly what each output file will contain.
The queue appears once the project has at least one source.

Rows can be expanded to reveal four sections: **episode info**, **tracks**,
**container**, and **chapters**.

## Queue overview

Four Season 1 episodes from the `Video` folder (specials from `Specials/`
appear after that source is added):

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/queue-basic.avif">
  <img src="../media/screenshots/light/project/queue-basic.avif" alt="Episode queue listing four Season 1 episodes">
</picture>

Each row shows the episode badge (e.g. **S01E01**), the output filename, and
the per-type match summary once expanded.

## Tracks

Expand an episode, then expand a track (video/audio/subtitle/attachment) to
edit its **codec, title, language, dispositions, delay, and tags** — these
overrides apply to that episode only:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/queue-tracks.avif">
  <img src="../media/screenshots/light/project/queue-tracks.avif" alt="Expanded episode with its video track details">
</picture>

### Dispositions

In an expanded track, click the **+** button next to *Dispositions* to open
the popover of stream flags. Toggle any disposition — for example switch
**Comment** on to mark the track as a commentary track (the switch shows
`checked`):

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/queue-track-comment.avif">
  <img src="../media/screenshots/light/project/queue-track-comment.avif" alt="Dispositions popover with the Comment switch enabled">
</picture>

## Container

The container section exposes container-level metadata such as the output
**Title**, shared by all episodes of the source:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/queue-container.avif">
  <img src="../media/screenshots/light/project/queue-container.avif" alt="Container section with the title field">
</picture>

## Chapters

The chapters section lists the chapters that will be written (four entries,
including *Quality Check*), with language and timestamp columns:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/queue-chapters.avif">
  <img src="../media/screenshots/light/project/queue-chapters.avif" alt="Chapters section listing four chapter entries">
</picture>

## Tooltips

### Output filename

Hover the filename (the `….mkv` text) on a row to see the full resolved
output path the muxer will write:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/filename-tooltip.avif">
  <img src="../media/screenshots/light/project/filename-tooltip.avif" alt="Tooltip showing the resolved output filename">
</picture>

### Per-source chapter toggle

In the chapters section, hovering the small toggle next to a chapter group
explains its action — *“Click to disable chapters from this source”* (or
*…enable…* once disabled):

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/disable-chapters-tooltip.avif">
  <img src="../media/screenshots/light/project/disable-chapters-tooltip.avif" alt="Tooltip on the per-source chapter toggle">
</picture>

## Related

- [Source editor](source.md) — where the matching rules feeding the queue are
  configured.
- [Stream Match Preview](stream-match-preview.md) — per-file track matching
  and exclusions.
