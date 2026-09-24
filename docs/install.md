# Installing MuxBox

MuxBox releases are **not code-signed or notarized**. Every platform will show
a warning the first time you launch the app — this page explains how to
proceed safely and how to verify what you downloaded.

## Verify your download

Every release ships a `SHA256SUMS.txt` next to the installers. Download both,
then compare hashes before running anything:

```sh
# Linux / macOS
sha256sum -c SHA256SUMS.txt --ignore-missing

# Windows (PowerShell)
Get-FileHash .\MuxBox-<version>-win-x64.exe -Algorithm SHA256
```

Match the output against the corresponding line in `SHA256SUMS.txt`.

## Which file do I need?

| Platform | File | Notes |
| --- | --- | --- |
| Windows 10/11, 64-bit Intel | `MuxBox-<version>-win-x64.exe` | NSIS installer (per-user, no admin) |
| Windows 11 on ARM | `MuxBox-<version>-win-arm64.exe` | Native installer; `mkvmerge` runs under x64 emulation, `opusenc` is native |
| Windows (any), no install | `MuxBox-<version>-win-x64-portable.exe` | Single portable executable; the x64 portable also runs on ARM via emulation |
| macOS, Apple Silicon (M1–M4) | `MuxBox-<version>-mac-arm64.dmg` | Match your chip — the Intel build would run under Rosetta |
| macOS, Intel | `MuxBox-<version>-mac-x64.dmg` | |
| Linux, any distro (glibc ≥ 2.28) | `MuxBox-<version>-linux-x64.AppImage` | `chmod +x` then run |
| Debian/Ubuntu | `…-linux-x64.deb` | `sudo apt install ./<file>.deb` |
| Fedora/RHEL | `…-linux-x64.rpm` | `sudo rpm -i <file>.rpm` |

All builds include `mkvmerge`/`mkvinfo` and `opusenc` — you do **not** need to
install MKVToolNix or opus-tools separately. If a system-wide `mkvmerge` is
already on your `PATH`, the bundled copy still takes priority.

## Windows

1. Download the installer (or the `-portable.exe` if you prefer no install).
2. **SmartScreen warning**: SmartScreen blocks unsigned executables by
   default. In the blue “Windows protected your PC” dialog, click
   **More info → Run anyway**.
   - Alternative: right-click the file → **Properties** → check
     **Unblock** at the bottom of the General tab → **OK**.
3. The NSIS installer offers a per-user install (no administrator prompt) and
   lets you choose the installation directory.
4. The portable build writes its data next to the executable — copy the single
   `.exe` anywhere (USB stick included).

### Windows on ARM

Install the `arm64` build for native `opusenc` performance. The bundled
`mkvmerge` is the official x64 build and runs through Windows 11's ARM
emulation. The x64 installer and portable build also work under emulation if
you cannot use the arm64 installer.

## macOS

1. Download the `.dmg` matching your chip (Apple Silicon vs Intel — **About
   This Mac** tells you which).
2. Open the `.dmg` and drag **MuxBox** into **Applications**.
3. **Gatekeeper warning**: because the app is unsigned, the first launch is
   blocked. Either:
   - **Right-click (or Control-click) the app → Open → Open** (do this once;
     later launches work normally), or
   - Remove the quarantine flag manually:

     ```sh
     xattr -cr /Applications/MuxBox.app
     ```

4. If macOS still refuses (recent macOS versions can be strict), run

   ```sh
   spctl --add /Applications/MuxBox.app
   ```

### Updates on macOS

Unsigned apps cannot install themselves on macOS, so MuxBox **notifies** you
when a new version exists and opens the release page in your browser.
Windows and Linux installs update themselves in-app.

## Linux

### AppImage

```sh
chmod +x MuxBox-<version>-linux-x64.AppImage
./MuxBox-<version>-linux-x64.AppImage
```

If your desktop environment warns about an untrusted image, use the file
manager's **Properties → Allow executing file as program**, or launch from a
terminal as shown above.

### deb / rpm

```sh
sudo apt install ./MuxBox-<version>-linux-x64.deb     # Debian/Ubuntu
sudo rpm -i MuxBox-<version>-linux-x64.rpm            # Fedora/RHEL
```

## Updating

- **Windows / Linux (installed builds):** MuxBox checks for updates on start
  and prompts to download and install the new version.
- **macOS:** prompted with a link to the release page (see above).
- **Portable Windows build:** no in-app updater — download the new portable
  executable and replace the old one.
- **Channels:** stable releases are plain `v*` tags; betas carry a `-beta.N`
  suffix and nightlies a `-nightly.<timestamp>` suffix. The app follows the
  channel it was installed from.

## Uninstalling

- **Windows installer:** Settings → Apps → MuxBox → Uninstall (the installer
  can also remove app data on uninstall).
- **Windows portable:** delete the executable.
- **macOS:** drag **MuxBox** to the Trash.
- **Linux:** remove the package (`sudo apt remove muxbox` / `sudo rpm -e muxbox`)
  or delete the AppImage.

User projects are stored outside the install directory and are kept unless you
delete them manually.
