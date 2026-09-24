/**
 * Coordinator entry point for the episode worker script.
 *
 * This is a side-effect module: importing it runs the worker bootstrap.
 * Vite bundles @app/muxer (and node-av) into the emitted episode-worker.js
 * chunk. In the compiled app the worker loads this bundle; in the main
 * process bundle this module is never imported (MuxCoordinator only loads
 * the emitted file via new Worker(path)).
 */
import './episode-worker.js';
