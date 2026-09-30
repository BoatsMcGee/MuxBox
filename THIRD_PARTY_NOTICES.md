# Third-Party Notices

MuxBox itself is MIT-licensed (see [`LICENSE`](LICENSE)). The following
third-party components are distributed with, or bundled into, MuxBox builds.
Full license texts for the command-line tools are shipped inside every
release package under `resources/tools/<platform>-<arch>/licenses/` (installed
apps) and staged in `buildResources/bin/<platform>-<arch>/licenses/` by
`npm run fetch:tools`.

## Bundled command-line tools

| Component | Version | License | Source |
| --- | --- | --- | --- |
| MKVToolNix (`mkvmerge`, `mkvinfo`) | 102.0 | GPL-2.0-or-later | <https://codeberg.org/mbunkus/mkvtoolnix> |
| opus-tools (`opusenc`) | 0.2 | BSD-2-Clause | <https://gitlab.xiph.org/xiph/opus-tools> |

**Windows binaries** come from the official MKVToolNix portable release
(`mkvtoolnix.download`) and from [MSYS2](https://www.msys2.org/) packages
(`mingw-w64-*-opus-tools` plus their runtime DLLs: FLAC, libogg, libopus,
libopusenc, opus, and the MinGW runtime libraries).

**macOS binaries**: `mkvmerge`/`mkvinfo` come from the official MKVToolNix
DMG release (`mkvtoolnix.download` — the same upstream build as the Windows
binaries above; Homebrew publishes no Intel-mac bottle for MKVToolNix),
including its bundled Qt6 dylib. `opusenc` comes from the repackaged
[Homebrew](https://brew.sh/) opus-tools bottle together with exactly the
homebrew-core runtime libraries its binaries link (discovered at fetch time;
SPDX identifiers for each formula are published at
<https://formulae.brew.sh/>).

**Linux binaries** are repackaged [Homebrew](https://brew.sh/) bottles built
from the sources above, together with their runtime library closure (Qt,
Boost, gettext, gmp, pugixml, libebml/libmatroska, and others — SPDX
identifiers for each formula are published by Homebrew at
<https://formulae.brew.sh/>). The libraries are dynamically linked; no
library is modified beyond relocation, and the corresponding source code for
every bundled bottle is available through the Homebrew/homebrew-core
repository and the upstream projects listed there.

GNU license texts included in the `licenses/` directory:

- `GPL-2.0.txt` — GNU General Public License v2.0 (MKVToolNix; GPL components)
- `LGPL-2.1.txt` — GNU Lesser GPL v2.1 (e.g. FFmpeg libraries)
- `LGPL-3.0.txt` — GNU Lesser GPL v3.0 (e.g. GCC runtime libraries, gmp, Qt)
- `opus-tools-COPYING.txt` — BSD terms for opus-tools

## Runtime libraries

| Component | License | Notes |
| --- | --- | --- |
| [Electron](https://www.electronjs.org/) | MIT (Chromium, Node.js: BSD-style) | Ships within the app bundle |
| [Chromium](https://www.chromium.org/) | BSD-style and others | See Electron distribution |
| [Node.js](https://nodejs.org/) | MIT | See Electron distribution |
| [FFmpeg](https://ffmpeg.org/) | LGPL-2.1-or-later (GPL-2.0-or-later when built with `--enable-gpl`) | Distributed as the prebuilt binary inside `node-av`; corresponding source: <https://ffmpeg.org/legal.html> |
| [node-av](https://github.com/seydx/node-av) | MIT | N-API native modules + FFmpeg downloader |
| [electron-updater](https://www.electron.build/auto-update) | MIT | Update checks |
| [Vue](https://vuejs.org/), [Pinia](https://pinia.vuejs.org/), [Tailwind CSS](https://tailwindcss.com/), [Reka UI](https://reka-ui.com/), [Monaco Editor](https://microsoft.github.io/monaco-editor/) | MIT | Renderer |

## Notes

- MuxBox performs **no code signing or notarization**; the bundled tools are
  redistributed unmodified except for the macOS/Linux relocation and rpath
  adjustments performed by `scripts/fetch-external-tools.mjs`, which do not
  alter program behavior.
- MKVToolNix is GPL-2.0-or-later software. MuxBox interacts with `mkvmerge`
  and `mkvinfo` exclusively through their command-line interfaces as a
  separate process; the corresponding source for the exact versions bundled
  is available from <https://codeberg.org/mbunkus/mkvtoolnix> (tag matching
  the version above).
- If you redistribute MuxBox builds, keep this file and the `licenses/`
  directory intact.
