# Stream Match Preview

Two panels of the [Source](source.md) editor work together:

- **Stream Configuration** (left) — typed rules that decide *how* matched
  streams are transformed (codec filters, language rules, modifies,
  preprocessing).
- **Stream Match Preview** (right) — the per-file outcome: which episode each
  file becomes, which streams matched, and per-track overrides.

## Stream Configuration

Rules are grouped by type via the **Video / Audio / Subtitle / Attachment**
tabs. Click the dashed **Add … Configuration** card to open the preset
popover:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/add-video-configuration.avif">
  <img src="../media/screenshots/light/source/add-video-configuration.avif" alt="Add video configuration preset popover">
</picture>

### Adding and renaming items

**New Configuration** appends an empty item named *Video Configuration*:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/new-video-configuration.avif">
  <img src="../media/screenshots/light/source/new-video-configuration.avif" alt="New empty video configuration item">
</picture>

Click its title to rename it inline — e.g. **HEVC Fallback** — and press
`Enter` to commit:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/rename-video-configuration.avif">
  <img src="../media/screenshots/light/source/rename-video-configuration.avif" alt="Configuration item renamed to HEVC Fallback">
</picture>

### Saving as a preset

The save button on a rule opens the **Save As** dialog, prefilled with the
rule's name so you can store it as a reusable preset:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/save-video-configuration.avif">
  <img src="../media/screenshots/light/source/save-video-configuration.avif" alt="Save As preset dialog">
</picture>

### Filters

The **Filter** section narrows which streams a rule applies to. Add a row,
pick a property, and search its value — first a **codec** filter for
H.264:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/filter-codec.avif">
  <img src="../media/screenshots/light/source/filter-codec.avif" alt="Codec filter set to H.264">
</picture>

…then a **language** filter (`eng`):

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/filter-language.avif">
  <img src="../media/screenshots/light/source/filter-language.avif" alt="Language filter set to eng">
</picture>

The braces button switches the section to **JSON mode** — the same filters as
editable JSON in the built-in Monaco editor (`codec`, `language`, `width` …):

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/filter-json.avif">
  <img src="../media/screenshots/light/source/filter-json.avif" alt="Filters expressed as JSON in Monaco">
</picture>

### Modify

**Modify** rewrites matched streams. Here a subtitle rule sets
**Language** `en-US`, **Title** *Narration Track*, and adds the **Comment**
disposition:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/modify.avif">
  <img src="../media/screenshots/light/source/modify.avif" alt="Subtitle modify rule with language, title, and comment disposition">
</picture>

The same rule in JSON form:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/modify-json.avif">
  <img src="../media/screenshots/light/source/modify-json.avif" alt="Modify rule expressed as JSON">
</picture>

**Delay (ms)** shifts a track's timestamps — here `250` ms on the subtitle
rule:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/modify-delay.avif">
  <img src="../media/screenshots/light/source/modify-delay.avif" alt="Modify rule with a 250 millisecond delay">
</picture>

#### zlib compression

Subtitle rules also carry a **Compression** toggle. It is **on by default** and compresses the track with zlib when muxing, which noticeably shrinks text subtitle. It applies **only to text-based subtitles** (SubRip, ASS/SSA, WebVTT). Bitmap subtitles such as PGS and VoBSub are already compressed, so the option is skipped for them.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/modify-compression.avif">
  <img src="../media/screenshots/light/source/modify-compression.avif" alt="Subtitle modify rule with the zlib compression toggle enabled">
</picture>

Compression is applied by `mkvmerge` after the mux finishes, so it only takes
effect on files you actually mux — it is not visible in the preview.

### Preprocess

**Preprocess** options run before muxing. For audio they drive the bundled
`opusenc`: **Bitrate**, **Downmix** (stereo/mono), **Complexity**, and
**Frame Size (ms)**, plus **Volume Workaround** and **Normalize**:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/opusenc-preprocess.avif">
  <img src="../media/screenshots/light/source/opusenc-preprocess.avif" alt="Opusenc preprocessing options on an audio rule">
</picture>

A simpler case — **Bitrate** `160` with **Downmix** *stereo* on the AAC 5.1 rule:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/preprocess.avif">
  <img src="../media/screenshots/light/source/preprocess.avif" alt="Preprocess section with bitrate and downmix options">
</picture>

## Stream Match Preview

The preview lists every probed file with a summary row
(**Video / Audio / Subtitle / Attachment / Chapters** matched counts), an
episode row (Season/Episode), Container, Chapters, and the track list.

### Unmatched tracks

When no rule matches a stream (here the `tlh` subtitle rule matches nothing),
its track shows a red ✗ and hovering the exclude toggle explains:
*“Track not matched”*:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/disable-subtitle.avif">
  <img src="../media/screenshots/light/source/disable-subtitle.avif" alt="Unmatched subtitle track with tooltip">
</picture>

### Per-file episode override

The **episode** section overrides season/episode numbers for one file — set to
`9`/`9` the badge reads **S09E09**:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/override-episode.avif">
  <img src="../media/screenshots/light/source/override-episode.avif" alt="Episode override set to S09E09">
</picture>

### Raw stream info

Any expanded track offers **Raw Stream Info** — the underlying stream data as
readable JSON:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/raw-stream-info.avif">
  <img src="../media/screenshots/light/source/raw-stream-info.avif" alt="Raw stream info JSON dialog">
</picture>

### Excluding a track

Hovering a matched track's toggle shows *“Click to exclude this track”* —
clicking keeps the stream out of the output for that file:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/disable-track.avif">
  <img src="../media/screenshots/light/source/disable-track.avif" alt="Tooltip offering to exclude a track">
</picture>

Clicking swaps the green ✓ for a 🛇 shield, marking the row as excluded:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/exclude-subtitle-track.avif">
  <img src="../media/screenshots/light/source/exclude-subtitle-track.avif" alt="Subtitle track excluded, shown with a shield badge">
</picture>

Clicking the shield again re-includes it and restores the ✓:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../media/screenshots/dark/source/exclude-subtitle-restored.avif">
  <img src="../media/screenshots/light/source/exclude-subtitle-restored.avif" alt="Subtitle track re-included with the green check restored">
</picture>

Note that excluding is per-episode: the same stream can be excluded in one
episode's queue without affecting the others.

## Related

- [Source](source.md) — pattern matching, metadata, and chapters basics.
- [Episode Queue](episode-queue.md) — project-side view of the results.
