# Home

The landing page is MuxBox's starting point: it lists every project and lets
you create new ones.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/homepage.avif">
  <img src="../media/screenshots/light/homepage.avif" alt="MuxBox home page with the project list">
</picture>

## Layout

- **Hero & title** — the MuxBox logo, the name, and the tagline *“Batch
  multiplexer with heuristics-based stream selection”*.
- **Settings button** (top right, gear icon) — opens [Settings](settings.md).
  A tooltip labels the icon on hover.
- **Projects card** — every project you have created, sorted by most recently
  opened.

## Working with projects

### Creating a project

Click **New Project** in the Projects card header. The new project is created,
persisted, and opened immediately. (When MuxBox starts with no projects at
all, it creates the first one for you automatically.)

### Opening a project

Click anywhere on a project row. Each row shows:

- the project name,
- the linked TMDB series name (when set),
- the number of sources,
- how long ago it was last opened (*just now*, *12 min ago*, *3 days ago*, …).

### Deleting a project

Hover a row and click the trash icon. A confirmation dialog asks you to confirm
— deletion is permanent.

### Empty state

If you delete every project, the card shows *“No projects yet. Create one to
get started.”* until you create a new one.

## Next steps

- [Project page](project.md) — configure sources and outputs.
- [Episode Queue](episode-queue.md) — review the episodes that will be muxed.
