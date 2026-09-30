# node-av patches

Applied automatically by `patch-package` on `postinstall`.

## Why

`Muxer.writePacketSync()` accounted for **79–92% of mux wall-clock at ~100% CPU**
(measured on a 20-track / 89-attachment MKV). Profiling traced it to per-packet
allocation churn in node-av's **JavaScript** layer, not in the native addon:

1. **`FormatContext.streams`** rebuilt a fresh `Stream` NAPI wrapper for *every*
   stream on *every* access. `Muxer.ofStreamcopy()` and `Muxer.muxFixupTs()` each read
   `this.formatContext.streams[streamIndex]` once per packet, so a 20-track output
   allocated **40 throwaway wrappers per packet**. At ~1,500 packets/sec that is
   tens of thousands of NAPI objects per second, purely as garbage.

   Benchmarked on a 14-stream file: 200,000 reads of this getter took **~8,700 ms**
   unpatched and **~1.3 ms** patched.

2. **`Array.from(this._streams.values()).some(...)`** in `writePacketSync` (and its
   async twin `writePacket`) allocated a fresh array of every stream info on *every*
   packet purely to evaluate a boolean.

After patching, a real mux run of S01E16 (806,312 packets) went from **3120 s to
772 s — a 4.0x speedup** — and a throughput "cliff" that had appeared at ~100k packets
in every run turned out not to exist; it was this allocation churn becoming visible as
buffers filled. (`instPps` peak rose from ~1,900 to ~14,900.)

## Contents

| file | change |
|---|---|
| `dist/lib/format-context.js` | memoise `get streams()`; invalidate the cache in `newStream()` |
| `dist/api/muxer.js` | replace the per-packet `Array.from(...).some(...)` with a plain loop in both write paths |

The `newStream()` invalidation is load-bearing: without it, `addStream()` would return
a stale array and silently drop newly added tracks. Verified at runtime — a 14-stream
file reports 15 after `newStream()`.

## Regenerating / updating

Upstream has **not** fixed the `streams` getter as of node-av `6.2.0-beta.25`, so this
patch remains necessary. When bumping node-av:

1. `npm install node-av@<new-version> --workspace @app/muxer` — `postinstall` will try
   to apply the existing patch and **fail loudly** if the upstream source has changed.
2. Re-apply the edits manually in `node_modules/node-av/dist/...`.
3. Delete the old patch file and regenerate:
   ```powershell
   Remove-Item patches\node-av+<old-version>.patch
   npx patch-package node-av
   ```

## Upstream

The real fix belongs in node-av itself
(<https://github.com/SeydX/node-av>). If a release memoises `FormatContext.streams`
and drops the per-packet `Array.from`, delete this file and remove
`patch-package` from `devDependencies` / `postinstall`.

Draft an upstream issue from this patch with:

```powershell
npx patch-package node-av --create-issue
```
