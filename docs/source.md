# Source (Add / Edit)

A **source** is one folder of input files plus the rules that turn its files
into episodes. Click the dashed **Add Source** card on the
[Project](project.md) page to create one, or a source card's edit action to
reopen it. The page header shows **Add Source** / **Edit Source** with the
selected directory and a **Browse** button.

The page has three areas:

1. **Header controls** — Match Pattern, capture groups, overrides, and the
   metadata/chapters copy toggles.
2. **Stream Configuration** — per-type rules (Video / Audio / Subtitle /
   Attachment tabs), covered in
   [Stream Match Preview](stream-match-preview.md).
3. **Stream Match Preview** — per-file results, covered in
   [Stream Match Preview](stream-match-preview.md).

Click **Save Changes** (or **Add Source**) in the footer to return to the
project; the queue rebuilds from the new rules.

## Opening the dialog

Choosing **Add Source** opens the editor with the directory picker result
filled in (via the native Browse dialog) and the preview probing the folder:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/add.avif">
  <img src="../media/screenshots/light/source/add.avif" alt="Add Source dialog with directory and preview">
</picture>

## Match pattern

The pattern is a regular expression tested against each filename. Type
anything and the preview filters live — with a pattern that matches every
file (such as `How`), the *n/m matched* counter hides because everything
matches:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/edit.avif">
  <img src="../media/screenshots/light/source/edit.avif" alt="Match pattern typed, all files matching">
</picture>

### Flags

The **i**, **g**, **m** buttons toggle regex flags. A plain pattern like
`\.mkv$` with the **i** flag (highlighted) applies case-insensitively:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/match-basic.avif">
  <img src="../media/screenshots/light/source/match-basic.avif" alt="Match pattern with case-insensitive flag enabled">
</picture>

### Capture groups

Patterns such as `s([0-9]+)e([0-9]+)` extract season and episode numbers —
set **Season Capture Group** and **Episode Capture Group** to the group
positions (1 and 2 by default). **Season Override** and **Episode Offset**
adjust the result afterwards:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/match-capture.avif">
  <img src="../media/screenshots/light/source/match-capture.avif" alt="Capture pattern with season and episode group numbers">
</picture>

## Copy metadata

**Copy Metadata** (shows the live count, e.g. *(4/4)*) copies container
metadata to every episode. The button becomes **Remove Metadata** while
enabled:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/metadata.avif">
  <img src="../media/screenshots/light/source/metadata.avif" alt="Metadata copying enabled for all episodes">
</picture>

A single episode can opt out from its **Container** section in the preview —
the button then shows the partial count **(3/4)**:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/metadata-partial.avif">
  <img src="../media/screenshots/light/source/metadata-partial.avif" alt="Metadata copying with one episode excluded">
</picture>

## Chapters

**Remove Chapters** / the chapter copy toggle (count *(4)*) controls whether
chapters are copied into every episode. Expanding the preview's **Chapters**
section shows the entries (here *Quality Check* among them):

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/chapters.avif">
  <img src="../media/screenshots/light/source/chapters.avif" alt="Chapters copied to episodes with the chapter list open">
</picture>

### Chapter delay

The per-file **Delay** field (ms) shifts chapter timestamps for one file.
With `500` ms applied, timestamps display as *original → shifted*
(`00:00:00.000 → 00:00:00.500`):

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/chapters-delayed.avif">
  <img src="../media/screenshots/light/source/chapters-delayed.avif" alt="Chapter timestamps shifted by a 500 ms delay">
</picture>

The **and delay by … ms** field in the header applies a delay at the source
level instead of per file.

## Next steps

- [Stream Match Preview](stream-match-preview.md) — configuration rules,
  filters, and per-file preview states.
- [Episode Queue](episode-queue.md) — the project-side view of the results.
