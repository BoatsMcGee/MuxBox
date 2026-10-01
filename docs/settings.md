# Settings

Settings configures MuxBox globally: TMDB access, appearance, how files are
multiplexed, and the [rename template](#default-rename-template) new projects
start with. Open it from the gear button on the [Home](home.md) page. Click
**← Back** in the header to return.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/settings.avif">
  <img src="../media/screenshots/light/settings.avif" alt="MuxBox settings page">
</picture>

## TMDB Access Token

The API token used for series lookups ([Project → TMDB search](project.md#tmdb-series-search)).

- Paste your personal read token from
  [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api).
- MuxBox does not ship a built-in token — a personal read token is required
  for TMDB search.
- The field is masked (password-style) so the token stays out of sight.

## Theme

Three buttons: **Light**, **Dark**, **Auto**. The selection applies
immediately after saving and controls whether MuxBox renders with the light
or dark palette (*Auto* follows your operating system setting).

## Default Rename Template

The rename template each new project starts with, so a preferred naming
convention only has to be set up once.

- The editor is the same one used on the
  [project page](project.md#rename-template) — click **Edit** to expand the
  template field, the **Example Preview**, and the per-field cards for prefix,
  suffix, always-add, and padding.
- When a project is created it **copies** this template and its field settings,
  so the project then has its own copy and is not tied to this setting.
- Projects you already have keep the template they are using — changing the
  default here never rewrites them. Edit an existing project's template on the
  project page.
- A template left blank falls back to the built-in
  `{Series} - S##E## - {Name}` with `S`/`E` prefixes, so a cleared field can
  never produce an empty filename.

## Multiplexer

Chooses the engine used to build the final files.

| Method | Description | Options |
| --- | --- | --- |
| **Native (NodeAV)** | In-process multiplexing via NodeAV. | **Keep negative packets** — carry packets with negative timestamps instead of dropping them. **Clip timestamps to 0** — shift negative timestamps to zero. |
| **FFmpeg** | Remux through FFmpeg with a temporary working directory. | **Temp directory** — read-only path with a **Browse** button that opens the native folder picker. |

## Muxing Concurrency

The maximum number of muxing jobs that run at the same time (1–64). Leave the
field empty to use the default of *CPU cores − 1*.

## Saving

Click **Save Settings** to persist all sections. The button shows *Saving…*
while writing and a green **Saved!** confirmation appears for a moment
afterwards. Changes do not take effect until you save.
