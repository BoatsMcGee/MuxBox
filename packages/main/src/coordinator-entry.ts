/**
 * Vite build entry for the episode worker script.
 *
 * The main-process bundle (dist/index.js) inlines @app/muxer. The worker
 * script must be a separate file so MuxCoordinator can load it with
 * new Worker(path). This entry simply imports the worker bootstrap; Vite
 * bundles @app/muxer (and node-av) into the emitted episode-worker.js chunk.
 */
import '@app/muxer/coordinator-entry';
