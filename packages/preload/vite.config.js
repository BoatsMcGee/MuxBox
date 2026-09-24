import {resolveModuleExportNames} from 'mlly';
import {getChromeMajorVersion} from '@app/electron-versions';

export default /**
 * @type {import('vite').UserConfig}
 * @see https://vitejs.dev/config/
 */
({
    build: {
        ssr: true,
        sourcemap: 'inline',
        outDir: 'dist',
        target: `chrome${getChromeMajorVersion()}`,
        assetsDir: '.',
        lib: {
            entry: ['src/exposed.ts', 'virtual:browser.js', 'src/main-exports.ts'],
        },
        rollupOptions: {
            external: (id, _importer) => {
                // Always externalize electron (available at runtime in preload/main context)
                if (id === 'electron') return true;
                // Also externalize @app/settings for main-process entry points
                if (_importer && _importer.includes('main-exports') && id === '@app/settings') {
                    return true;
                }
                return false;
            },
            output: [
                {
                    // ESM preload scripts must have the .mjs extension
                    // https://www.electronjs.org/docs/latest/tutorial/esm#esm-preload-scripts-must-have-the-mjs-extension
                    entryFileNames: '[name].mjs',
                },
            ],
        },
        emptyOutDir: true,
        reportCompressedSize: false,
    },
    plugins: [mockExposed(), handleHotReload()],
});


/**
 * This plugin creates a browser (renderer) version of `preload` package.
 * Basically, it just read all nominals you exported from package and define it as globalThis properties
 * expecting that real values were exposed by `electron.contextBridge.exposeInMainWorld()`
 */
function mockExposed() {
    const virtualModuleId = 'virtual:browser.js';
    const resolvedVirtualModuleId = '\0' + virtualModuleId;

    return {
        name: 'electron-main-exposer',
        resolveId(id) {
            if (id.endsWith(virtualModuleId)) {
                return resolvedVirtualModuleId;
            }
        },
        async load(id) {
            if (id === resolvedVirtualModuleId) {
                const exportedNames = await resolveModuleExportNames('./src/index.ts', {
                    url: import.meta.url,
                });
                return exportedNames.reduce((s, key) => {
                    return (
                        s +
            (key === 'default'
                ? `export default globalThis['${btoa(key)}'];\n`
                : `export const ${key} = globalThis['${btoa(key)}'];\n`)
                    );
                }, '');
            }
        },
    };
}


/**
 * Implement Electron renderer reload when preload files change.
 * Uses build.watch with an include pattern to only watch preload source files,
 * preventing infinite rebuild loops caused by renderer HMR triggering preload rebuilds.
 */
function handleHotReload() {
    /** @type {import('vite').ViteDevServer|null} */
    let rendererWatchServer = null;

    return {
        name: '@app/preload-process-hot-reload',

        config(config, env) {
            if (env.mode !== 'development') {
                return;
            }

            const rendererWatchServerProvider = config.plugins.find(p => p.name === '@app/renderer-watch-server-provider');
            if (!rendererWatchServerProvider) {
                throw new Error('Renderer watch server provider not found');
            }

            rendererWatchServer = rendererWatchServerProvider.api.provideRendererWatchServer();

            return {
                build: {
                    watch: {
                        // Only watch the preload's own src directory to avoid
                        // infinite loops from renderer HMR triggering preload rebuilds
                        include: ['src/**'],
                        exclude: ['**/node_modules/**', '**/dist/**'],
                    },
                },
            };
        },

        writeBundle() {
            if (!rendererWatchServer) {
                return;
            }

            rendererWatchServer.ws.send({
                type: 'full-reload',
            });
        },
    };
}
