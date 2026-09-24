import {type AppModule} from '../AppModule.js';
import {app, dialog, shell} from 'electron';
import electronUpdater, {type AppUpdater, type Logger, type UpdateInfo} from 'electron-updater';

type DownloadNotification = Parameters<AppUpdater['checkForUpdatesAndNotify']>[0];

/** GitHub repository hosting the releases opened from macOS update prompts. */
export const RELEASES_URL = 'https://github.com/BoatsMcGee/MuxBox/releases/tag';

export interface AutoUpdaterOptions {
    logger?: Logger | null | undefined;
    downloadNotification?: DownloadNotification;
    /** Injectable for tests; defaults to `process.platform`. */
    platform?: NodeJS.Platform;
    /** Injectable for tests; defaults to `app.isPackaged`. */
    isPackaged?: boolean;
}

export class AutoUpdater implements AppModule {

    readonly #logger: Logger | null;
    readonly #notification: DownloadNotification;
    readonly #platform: NodeJS.Platform | undefined;
    readonly #isPackaged: boolean | undefined;

    constructor(
        {
            logger = null,
            downloadNotification = undefined,
            platform = undefined,
            isPackaged = undefined,
        }: AutoUpdaterOptions = {},
    ) {
        this.#logger = logger;
        this.#notification = downloadNotification;
        this.#platform = platform;
        this.#isPackaged = isPackaged;
    }

    async enable(): Promise<void> {
        await this.runAutoUpdater();
    }

    getAutoUpdater(): AppUpdater {
    // Using destructuring to access autoUpdater due to the CommonJS module of 'electron-updater'.
    // It is a workaround for ESM compatibility issues, see https://github.com/electron-userland/electron-builder/issues/7976.
        const {autoUpdater} = electronUpdater;
        return autoUpdater;
    }

    async runAutoUpdater(): Promise<unknown> {
        const updater = this.getAutoUpdater();
        try {
            updater.logger = this.#logger || null;
            updater.fullChangelog = true;

            if (import.meta.env.VITE_DISTRIBUTION_CHANNEL) {
                updater.channel = import.meta.env.VITE_DISTRIBUTION_CHANNEL;
            }

            if (!(this.#isPackaged ?? app.isPackaged)) {
                // Unpackaged dev sessions ship no app-update.yml and have
                // nothing to update from — skip silently.
                return null;
            }

            if ((this.#platform ?? process.platform) === 'darwin') {
                // Unsigned builds cannot apply macOS updates (Gatekeeper
                // requires a signed and notarized app), so macOS only gets a
                // notification with a link to the release page.
                updater.autoDownload = false;
                updater.on('update-available', (info: UpdateInfo) => {
                    void this.#notifyDarwin(info);
                });
                return await updater.checkForUpdates();
            }

            return await updater.checkForUpdatesAndNotify(this.#notification);
        } catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('No published versions')) {
                    return null;
                }

                // The GitHub releases feed answers 404 while the repository
                // or its releases do not exist yet — nothing to update from.
                if (('code' in error && error.code === 'HTTP_ERROR_404')
                    || error.message.includes('HTTP Error: 404')) {
                    return null;
                }

                // Builds without a publish configuration ship no
                // resources/app-update.yml — there is simply nothing to update
                // from, and app startup must not fail over it (otherwise the
                // rejected enable() promise tears down the whole app).
                if ('code' in error
                    && error.code === 'ENOENT'
                    && 'path' in error
                    && typeof error.path === 'string'
                    && error.path.endsWith('app-update.yml')) {
                    return null;
                }
            }

            throw error;
        }
    }

    /** Prompt about the update; opening the release page downloads it. */
    async #notifyDarwin(info: UpdateInfo): Promise<void> {
        try {
            const {response} = await dialog.showMessageBox({
                type: 'info',
                title: 'Update available',
                message: `MuxBox ${info.version} is available`,
                detail: 'MuxBox cannot update itself on macOS without code signing. '
                    + 'Download the new version from the GitHub releases page.',
                buttons: ['Download', 'Later'],
                defaultId: 0,
                cancelId: 1,
            });
            if (response === 0) {
                await shell.openExternal(`${RELEASES_URL}/v${info.version}`);
            }
        } catch {
            // The window may already be closed; a failed prompt is not fatal.
        }
    }
}


export function autoUpdater(...args: ConstructorParameters<typeof AutoUpdater>) {
    return new AutoUpdater(...args);
}
