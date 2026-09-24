import type {AppModule} from '../AppModule.js';
import {type ModuleContext} from '../ModuleContext.js';
import {BrowserWindow} from 'electron';
import type {AppInitConfig} from '../AppInitConfig.js';
import {getSettings, saveSettings} from '@app/preload/main';

class WindowManager implements AppModule {
    readonly #preload: {path: string};
    readonly #renderer: {path: string} | URL;
    readonly #openDevTools;

    constructor({initConfig, openDevTools = false}: {initConfig: AppInitConfig, openDevTools?: boolean}) {
        this.#preload = initConfig.preload;
        this.#renderer = initConfig.renderer;
        this.#openDevTools = openDevTools;
    }

    async enable({app}: ModuleContext): Promise<void> {
        await app.whenReady();
        await this.restoreOrCreateWindow(true);
        app.on('second-instance', () => this.restoreOrCreateWindow(true));
        app.on('activate', () => this.restoreOrCreateWindow(true));
    }

    async createWindow(): Promise<BrowserWindow> {
        const settings = await getSettings();

        const browserWindow = new BrowserWindow({
            width: settings.windowWidth ?? 1200,
            height: settings.windowHeight ?? 800,
            x: settings.windowX ?? undefined,
            y: settings.windowY ?? undefined,
            show: false, // Use the 'ready-to-show' event to show the instantiated BrowserWindow.
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                // The preload needs full Node.js (e.g. node:crypto), which sandboxed
                // preloads cannot access; contextIsolation + nodeIntegration: false
                // keep the page itself isolated from Node APIs.
                sandbox: false,
                webviewTag: false, // The webview tag is not recommended. Consider alternatives like an iframe or Electron's BrowserView. @see https://www.electronjs.org/docs/latest/api/webview-tag#warning
                preload: this.#preload.path,
            },
        });

        if (settings.windowIsMaximized) {
            browserWindow.maximize();
        }

        if (this.#renderer instanceof URL) {
            await browserWindow.loadURL(this.#renderer.href);
        } else {
            await browserWindow.loadFile(this.#renderer.path);
        }

        this.setupStatePersistence(browserWindow);

        return browserWindow;
    }

    async restoreOrCreateWindow(show = false) {
        let window = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());

        if (window === undefined) {
            window = await this.createWindow();
        }

        if (!show) {
            return window;
        }

        if (window.isMinimized()) {
            window.restore();
        }

        window?.show();

        if (this.#openDevTools) {
            window?.webContents.openDevTools();
        }

        window.focus();

        return window;
    }

    /**
     * Sets up event listeners to persist window state (position, size, maximized) to settings.
     * Uses debouncing to avoid excessive disk writes during resize/move operations.
     */
    setupStatePersistence(window: BrowserWindow): void {
        let saveTimer: ReturnType<typeof setTimeout> | null = null;

        const debouncedSave = () => {
            if (saveTimer !== null) {
                clearTimeout(saveTimer);
            }
            saveTimer = setTimeout(async () => {
                const isMaximized = window.isMaximized();
                if (!isMaximized) {
                    const [x, y] = window.getPosition();
                    const [width, height] = window.getSize();
                    await saveSettings({
                        windowWidth: width,
                        windowHeight: height,
                        windowX: x,
                        windowY: y,
                        windowIsMaximized: false,
                    });
                } else {
                    await saveSettings({windowIsMaximized: true});
                }
            }, 300);
        };

        window.on('resize', debouncedSave);
        window.on('move', debouncedSave);
        window.on('maximize', debouncedSave);
        window.on('unmaximize', debouncedSave);

        // Save immediately on close (no debounce) to ensure final state is captured
        window.on('close', async () => {
            if (saveTimer !== null) {
                clearTimeout(saveTimer);
            }
            const isMaximized = window.isMaximized();
            if (!isMaximized) {
                const [x, y] = window.getPosition();
                const [width, height] = window.getSize();
                await saveSettings({
                    windowWidth: width,
                    windowHeight: height,
                    windowX: x,
                    windowY: y,
                    windowIsMaximized: false,
                });
            } else {
                await saveSettings({windowIsMaximized: true});
            }
        });
    }
}

export function createWindowManagerModule(...args: ConstructorParameters<typeof WindowManager>) {
    return new WindowManager(...args);
}
