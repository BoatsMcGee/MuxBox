import {afterEach, beforeEach, describe, it, expect, vi} from 'vitest';
import {dialog, shell} from 'electron';
import electronUpdater, {type UpdateInfo} from 'electron-updater';
import {AutoUpdater, RELEASES_URL} from '@app/main/src/modules/AutoUpdater.js';

vi.mock('electron', async () => {
    const {vi: viFn} = await import('vitest');
    return {
        app: {isPackaged: false},
        dialog: {
            showMessageBox: viFn.fn().mockResolvedValue({response: 0, checkboxChecked: false}),
        },
        shell: {
            openExternal: viFn.fn().mockResolvedValue(undefined),
        },
    };
});

vi.mock('electron-updater', async () => {
    const {EventEmitter} = await import('node:events');
    const {vi: viFn} = await import('vitest');

    class MockAutoUpdater extends EventEmitter {
        checkForUpdatesAndNotify = viFn.fn(async () => null);
        checkForUpdates = viFn.fn(async () => null);
        logger: unknown = null;
        fullChangelog = false;
        channel = '';
        autoDownload = true;
    }

    return {
        default: {autoUpdater: new MockAutoUpdater()},
    };
});

const updater = electronUpdater.autoUpdater;
const showMessageBox = vi.mocked(dialog.showMessageBox);
const openExternal = vi.mocked(shell.openExternal);
const checkForUpdates = vi.mocked(updater.checkForUpdates);
const checkForUpdatesAndNotify = vi.mocked(updater.checkForUpdatesAndNotify);

/** Build an ENOENT error shaped like Node's fs errors (code + path present). */
function enoent(path: string): Error {
    return Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
        code: 'ENOENT',
        path,
    });
}

const updateInfo: UpdateInfo = {
    version: '9.9.9',
    files: [],
    path: 'MuxBox-9.9.9.zip',
    sha512: '',
    releaseDate: '2026-09-23 12:00:00',
};

describe('AutoUpdater.runAutoUpdater', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        updater.removeAllListeners();
        updater.channel = '';
        updater.autoDownload = true;
        showMessageBox.mockResolvedValue({response: 0, checkboxChecked: false});
        openExternal.mockResolvedValue(undefined);
        checkForUpdates.mockResolvedValue(null as never);
        checkForUpdatesAndNotify.mockResolvedValue(null as never);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    const packagedWin = {isPackaged: true, platform: 'win32' as NodeJS.Platform};

    it('does not fail startup when app-update.yml is missing (unpublished build)', async () => {
        checkForUpdatesAndNotify.mockRejectedValue(
            enoent('P:/app/resources/app-update.yml'),
        );

        await expect(new AutoUpdater(packagedWin).runAutoUpdater()).resolves.toBeNull();
    });

    it('swallows "No published versions" errors', async () => {
        checkForUpdatesAndNotify.mockRejectedValue(new Error('No published versions'));

        await expect(new AutoUpdater(packagedWin).runAutoUpdater()).resolves.toBeNull();
    });

    it('swallows a 404 releases feed (repository/releases not published yet)', async () => {
        const notFound = Object.assign(new Error('Error: HTTP Error: 404'), {
            code: 'HTTP_ERROR_404',
        });
        checkForUpdatesAndNotify.mockRejectedValue(notFound);

        await expect(new AutoUpdater(packagedWin).runAutoUpdater()).resolves.toBeNull();
    });

    it('swallows a 404 surfaced only through the message', async () => {
        checkForUpdatesAndNotify.mockRejectedValue(
            new Error('getaddrinfo ENOTFOUND github.com: HTTP Error: 404'),
        );

        await expect(new AutoUpdater(packagedWin).runAutoUpdater()).resolves.toBeNull();
    });

    it('swallows a 406 releases feed (no published release to update from)', async () => {
        const notAcceptable = Object.assign(new Error(
            'Cannot parse releases feed: Error: Unable to find latest version on GitHub '
                + '(https://github.com/BoatsMcGee/MuxBox/releases/latest), '
                + 'please ensure a production release exists: HttpError: 406',
        ), {
            code: 'HTTP_ERROR_406',
        });
        checkForUpdatesAndNotify.mockRejectedValue(notAcceptable);

        await expect(new AutoUpdater(packagedWin).runAutoUpdater()).resolves.toBeNull();
    });

    it('swallows a 406 surfaced only through the message', async () => {
        checkForUpdatesAndNotify.mockRejectedValue(
            new Error('Unable to find latest version on GitHub: HttpError: 406'),
        );

        await expect(new AutoUpdater(packagedWin).runAutoUpdater()).resolves.toBeNull();
    });

    it('logs instead of rejecting on unexpected updater errors', async () => {
        const error = new Error('network down');
        checkForUpdatesAndNotify.mockRejectedValue(error);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(new AutoUpdater(packagedWin).runAutoUpdater()).resolves.toBeNull();

        expect(consoleError).toHaveBeenCalledWith('Update check failed:', error);
        consoleError.mockRestore();
    });

    it('logs instead of rejecting for other missing files', async () => {
        checkForUpdatesAndNotify.mockRejectedValue(enoent('P:/app/resources/other.yml'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(new AutoUpdater(packagedWin).runAutoUpdater()).resolves.toBeNull();

        expect(consoleError).toHaveBeenCalledTimes(1);
        consoleError.mockRestore();
    });

    it('never lets a failed update check reject enable()', async () => {
        checkForUpdatesAndNotify.mockRejectedValue(new Error('GitHub unreachable'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(new AutoUpdater(packagedWin).enable()).resolves.toBeUndefined();

        consoleError.mockRestore();
    });

    it('does nothing in unpackaged dev sessions', async () => {
        const result = await new AutoUpdater({isPackaged: false, platform: 'win32'}).runAutoUpdater();

        expect(result).toBeNull();
        expect(checkForUpdatesAndNotify).not.toHaveBeenCalled();
        expect(checkForUpdates).not.toHaveBeenCalled();
    });

    it('uses checkForUpdatesAndNotify with auto-download on win32', async () => {
        await new AutoUpdater(packagedWin).runAutoUpdater();

        expect(checkForUpdatesAndNotify).toHaveBeenCalledTimes(1);
        expect(checkForUpdates).not.toHaveBeenCalled();
        expect(updater.autoDownload).toBe(true);
    });

    it('uses a non-downloading checkForUpdates on darwin', async () => {
        await new AutoUpdater({isPackaged: true, platform: 'darwin'}).runAutoUpdater();

        expect(checkForUpdates).toHaveBeenCalledTimes(1);
        expect(checkForUpdatesAndNotify).not.toHaveBeenCalled();
        expect(updater.autoDownload).toBe(false);
    });

    it('prompts and opens the release page when a darwin update is available', async () => {
        await new AutoUpdater({isPackaged: true, platform: 'darwin'}).runAutoUpdater();

        updater.emit('update-available', updateInfo);
        await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));

        expect(showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
            message: `MuxBox ${updateInfo.version} is available`,
        }));
        expect(openExternal).toHaveBeenCalledWith(`${RELEASES_URL}/v${updateInfo.version}`);
    });

    it('does not open the release page when the user picks Later', async () => {
        showMessageBox.mockResolvedValue({response: 1, checkboxChecked: false});

        await new AutoUpdater({isPackaged: true, platform: 'darwin'}).runAutoUpdater();
        updater.emit('update-available', updateInfo);
        await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1));

        expect(openExternal).not.toHaveBeenCalled();
    });

    it('applies the distribution channel to the updater', async () => {
        vi.stubEnv('VITE_DISTRIBUTION_CHANNEL', 'beta');

        await new AutoUpdater(packagedWin).runAutoUpdater();

        expect(updater.channel).toBe('beta');
    });

    it('survives a failed darwin prompt (window already gone)', async () => {
        showMessageBox.mockRejectedValue(new Error('Object has been destroyed'));

        await new AutoUpdater({isPackaged: true, platform: 'darwin'}).runAutoUpdater();
        updater.emit('update-available', updateInfo);
        await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1));

        expect(openExternal).not.toHaveBeenCalled();
    });
});
