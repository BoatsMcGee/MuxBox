import { existsSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Options for {@link resolveTool}. Every value defaults to the ambient
 * process environment; they exist so tests can exercise the lookup order
 * without touching the real filesystem.
 */
export interface ResolveToolOptions {
    /** Absolute path to the packaged app's `resources` directory. */
    resourcesPath?: string | undefined;
    /** Project root used for the development-time lookup. */
    cwd?: string;
    platform?: NodeJS.Platform;
    arch?: string;
    exists?: (candidate: string) => boolean;
}

/**
 * `process.resourcesPath` is injected by Electron at runtime but is not part
 * of the Node typings, so it is read through this narrow alias.
 */
type ProcessWithResources = NodeJS.Process & { readonly resourcesPath?: string };

/**
 * Resolve an external CLI tool (`mkvmerge`, `mkvinfo`, `opusenc`, …).
 *
 * Lookup order:
 * 1. Bundled copy: `<resources>/tools/<platform>-<arch>/bin/<tool>` —
 *    populated from `buildResources/bin` via `extraResources` at package
 *    time (see `scripts/fetch-external-tools.mjs`).
 * 2. Development copy: `<cwd>/buildResources/bin/<platform>-<arch>/bin/<tool>`
 *    after `npm run fetch:tools`.
 * 3. The bare tool name, deferring to `PATH` — keeps un-packaged dev setups
 *    and machines with a system-wide install working.
 *
 * @param tool - Tool base name without extension (e.g. `mkvmerge`).
 * @param options - Lookup overrides for testing.
 * @returns An absolute path, or the bare tool name for a `PATH` lookup.
 */
export function resolveTool(tool: string, options: ResolveToolOptions = {}): string {
    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    const exists = options.exists ?? existsSync;

    const fileName = platform === 'win32' ? `${tool}.exe` : tool;
    const archDir = `${platform}-${arch}`;

    const candidates: string[] = [];

    const resourcesPath = options.resourcesPath
        ?? (process as ProcessWithResources).resourcesPath;
    if (resourcesPath !== undefined && resourcesPath !== '') {
        candidates.push(path.join(resourcesPath, 'tools', archDir, 'bin', fileName));
    }

    const cwd = options.cwd ?? process.cwd();
    candidates.push(path.join(cwd, 'buildResources', 'bin', archDir, 'bin', fileName));

    for (const candidate of candidates) {
        if (exists(candidate)) {
            return candidate;
        }
    }

    return tool;
}
