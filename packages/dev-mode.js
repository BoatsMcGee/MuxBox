import {build, createServer} from 'vite';
import path from 'path';

/**
 * This script is designed to run multiple packages of your application in a special development mode.
 * To do this, you need to follow a few steps:
 */


/**
 * 1. We create a few flags to let everyone know that we are in development mode.
 */
const mode = 'development';
process.env.NODE_ENV = mode;
process.env.MODE = mode;


/**
 * Start the renderer dev server first — the other packages depend on its URL.
 */
/**
 * @type {import('vite').ViteDevServer}
 */
const rendererWatchServer = await createServer({
    mode,
    root: path.resolve('packages/renderer'),
});

await rendererWatchServer.listen();


/**
 * Provider plugin exposing the renderer dev server to the other build processes.
 */
/** @type {import('vite').Plugin<import('vite').ViteDevServer>} */
const rendererWatchServerProvider = {
    name: '@app/renderer-watch-server-provider',
    api: {
        provideRendererWatchServer() {
            return rendererWatchServer;
        },
    },
};


/**
 * Build preload and main; each receives the provider plugin for hot updates.
 */

/** @type {string[]} */
const packagesToStart = [
    'packages/preload',
    'packages/main',
];

for (const pkg of packagesToStart) {
    await build({
        mode,
        root: path.resolve(pkg),
        plugins: [
            rendererWatchServerProvider,
        ],
    });
}
