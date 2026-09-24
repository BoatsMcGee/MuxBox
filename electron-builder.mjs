import pkg from './package.json' with {type: 'json'};
import mapWorkspaces from '@npmcli/map-workspaces';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export default /** @type import('electron-builder').Configuration */
({
    appId: 'com.boatsmcgee.muxbox',
    productName: 'MuxBox',
    directories: {
        output: 'dist',
        buildResources: 'buildResources',
    },
    generateUpdatesFilesForAllChannels: true,
    publish: {
        provider: 'github',
        owner: 'BoatsMcGee',
        repo: 'MuxBox',
    },
    // Bundled CLI tools fetched by scripts/fetch-external-tools.mjs into
    // buildResources/bin/<platform>-<arch>. The runtime resolver
    // (packages/mkvtoolnix/src/resolve-tool.ts) looks them up under
    // process.resourcesPath/tools/<platform>-<arch> and falls back to PATH.
    extraResources: [
        {
            from: 'buildResources/bin',
            to: 'tools',
            filter: ['**/*'],
        },
    ],
    // node-av ships native binaries and a bundled FFmpeg that are spawned at
    // runtime — they must live outside the asar archive.
    asarUnpack: ['**/node_modules/node-av/**'],
    linux: {
        target: ['AppImage', 'deb', 'rpm'],
        category: 'Utility',
        synopsis: 'Batch media multiplexer with heuristics-based stream selection',
        description: 'Batch media multiplexer with heuristics-based stream selection',
        maintainer: 'Boats McGee <142189976+BoatsMcGee@users.noreply.github.com>',
        vendor: 'MuxBox',
    },
    mac: {
        category: 'public.app-category.utilities',
        // Unsigned distribution: no code-signing identity, no notarization.
        // Gatekeeper workarounds are documented in docs/install.md.
        identity: null,
        notarize: false,
        // Arch is selected per CI job via `--mac --x64` / `--mac --arm64`;
        // a bare local build uses the host architecture.
        target: ['dmg', 'zip'],
    },
    win: {
        icon: './buildResources/icon.png',
        target: [
            {
                target: 'nsis',
            },
            {
                target: 'portable',
            },
        ],
    },
    portable: {
        artifactName: '${productName}-${version}-${os}-${arch}-portable.${ext}',
    },
    nsis: {
        oneClick: false,
        perMachine: false,
        allowElevation: true,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        installerIcon: './buildResources/icon.ico',
        uninstallerIcon: './buildResources/icon.ico',
        installerHeaderIcon: './buildResources/icon.ico',
        deleteAppDataOnUninstall: true,

    },
    /**
   * It is recommended to avoid using non-standard characters such as spaces in artifact names,
   * as they can unpredictably change during deployment, making them impossible to locate and download for update.
   */
    artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
    files: [
        'LICENSE*',
        'THIRD_PARTY_NOTICES*',
        pkg.main,
        '!node_modules/@app/**',
        ...await getListOfFilesFromEachWorkspace(),
    ],
});

/**
 * By default, electron-builder copies each package into the output compilation entirety,
 * including the source code, tests, configuration, assets, and any other files.
 *
 * So you may get compiled app structure like this:
 * ```
 * app/
 * ├── node_modules/
 * │   └── workspace-packages/
 * │       ├── package-a/
 * │       │   ├── src/            # Garbage. May be safely removed
 * │       │   ├── dist/
 * │       │   │   └── index.js    # Runtime code
 * │       │   ├── vite.config.js  # Garbage
 * │       │   ├── .env            # some sensitive config
 * │       │   └── package.json
 * │       ├── package-b/
 * │       ├── package-c/
 * │       └── package-d/
 * ├── packages/
 * │   └── entry-point.js
 * └── package.json
 * ```
 *
 * To prevent this, we read the “files”
 * property from each package's package.json
 * and add all files that do not match the patterns to the exclusion list.
 *
 * This way,
 * each package independently determines which files will be included in the final compilation and which will not.
 *
 * So if `package-a` in its `package.json` describes
 * ```json
 * {
 *   "name": "package-a",
 *   "files": [
 *     "dist/**\/"
 *   ]
 * }
 * ```
 *
 * Then in the compilation only those files and `package.json` will be included:
 * ```
 * app/
 * ├── node_modules/
 * │   └── workspace-packages/
 * │       ├── package-a/
 * │       │   ├── dist/
 * │       │   │   └── index.js    # Runtime code
 * │       │   └── package.json
 * │       ├── package-b/
 * │       ├── package-c/
 * │       └── package-d/
 * ├── packages/
 * │   └── entry-point.js
 * └── package.json
 * ```
 */
async function getListOfFilesFromEachWorkspace() {

    /**
   * @type {Map<string, string>}
   */
    const workspaces = await mapWorkspaces({
        cwd: process.cwd(),
        pkg,
    });

    const allFilesToInclude = [];

    for (const [name, path] of workspaces) {
        const pkgPath = join(path, 'package.json');
        const {default: workspacePkg} = await import(pathToFileURL(pkgPath), {with: {type: 'json'}});

        let patterns = workspacePkg.files || ['dist/**', 'package.json'];

        patterns = patterns.map(p => join('node_modules', name, p));
        allFilesToInclude.push(...patterns);
    }

    return allFilesToInclude;
}
