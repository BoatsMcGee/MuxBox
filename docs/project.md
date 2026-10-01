# Project

A project ties together the input folders (**Sources**) and the resulting
episode files. The page has two columns: **Project Settings** on the left and
the [Episode Queue](episode-queue.md) on the right.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/main.avif">
  <img src="../media/screenshots/light/project/main.avif" alt="Project page with settings column and episode queue">
</picture>

All changes save automatically (debounced) — there is no Save button to hunt
for. **Undo** / **Redo** buttons in the toolbar revert or re-apply project
edits (`Ctrl+Z` / `Ctrl+Shift+Z`).

## Empty project

A project without sources shows only the settings column and the dashed
**Add Source** card — the queue panel stays hidden until at least one source
exists.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/empty.avif">
  <img src="../media/screenshots/light/project/empty.avif" alt="Empty project showing only the Add Source card">
</picture>

## Output directory

Where finished files are written. The field is read-only — click **Browse**
to pick a folder through the native directory dialog.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/output-directory.avif">
  <img src="../media/screenshots/light/project/output-directory.avif" alt="Output directory field with a newly chosen folder">
</picture>

## Tags

Tags are free-form key/value pairs stored on the project (for example
`type: TV`). Click **Edit Tags**, then **Add Tag**, fill in **Key…** and
**Value…**, and confirm with **Apply** (or discard with **Cancel**).

Every applied edit lands in history, so the screenshot below shows a tag added
and then restored with **Redo** after an **Undo**:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/undo-redo.avif">
  <img src="../media/screenshots/light/project/undo-redo.avif" alt="Project tags editor with an added tag after undo and redo">
</picture>

## Rename template

The template that turns each episode's parsed name into the final filename.
Click **Edit** next to the template to enter edit mode: an editable template
text, a live **Example Preview**, and cards explaining every available field.
A template to use as the starting point for new projects can be set once in
[Settings → Default Rename Template](settings.md#default-rename-template); a
project created afterwards starts from a copy of it, and the template here
stays independent from then on.

## TMDB series search

Type into **“Search for a series on TMDB…”** to search while you type. Picking
a result links the series to the project and powers the seasons browser,
episode titles, and the queue badges.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/series-search.avif">
  <img src="../media/screenshots/light/project/series-search.avif" alt="TMDB series search with live results">
</picture>

## Seasons browser

The **Seasons** button opens the season browser (Season 1 is expanded by
default):

- Rename any season inline — the input shows the season's display name
  (seeded with a custom name such as *Special Editions* for season 0).
- Each season header shows its episode count (e.g. *13 episodes*).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/seasons-browser.avif">
  <img src="../media/screenshots/light/project/seasons-browser.avif" alt="Seasons browser modal listing seasons and episode counts">
</picture>

### Overriding an episode title

In a season's episode list, click the pencil button on an episode row and type
an **Override title…**, then press `Enter`. The override sticks even after
closing the browser.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/episode-name-modal.avif">
  <img src="../media/screenshots/light/project/episode-name-modal.avif" alt="Episode row with an overridden title">
</picture>

The rename template editor likewise opens as a modal-style edit mode with the
example preview and field cards:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/rename-template-modal.avif">
  <img src="../media/screenshots/light/project/rename-template-modal.avif" alt="Rename template edit mode with example preview">
</picture>

## Sources

Each added folder appears as a source card showing its directory, with:

- **Use Filenames** — take this source's filenames for the episodes instead of
  the template.
- **Show in folder** (external-link icon) — reveal the directory.
- **Delete Source** (trash icon) — remove the source (disabled while a mux job
  is running; the tooltip then explains why).

Below the cards, the dashed **Add Source** card opens the
[Source editor](source.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/project/sources.avif">
  <img src="../media/screenshots/light/project/sources.avif" alt="Project sources list with one source and the Add Source card">
</picture>

## Next steps

- [Episode Queue](episode-queue.md) — review and adjust the episodes.
- [Source editor](source.md) — tune matching, metadata, and chapters.
