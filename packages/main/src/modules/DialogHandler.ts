import { ipcMain, dialog, app, shell } from 'electron';
import { existsSync } from 'node:fs';
import { type AppModule } from '../AppModule.js';
import { type ModuleContext } from '../ModuleContext.js';

export class DialogHandler implements AppModule {
    enable(_context: ModuleContext): void {
        ipcMain.handle('app:getUserDataPath', () => {
            return app.getPath('userData');
        });

        ipcMain.handle('dialog:openDirectory', async (_event, defaultPath?: string) => {
            const result = await dialog.showOpenDialog({
                properties: ['openDirectory'],
                // Open the picker at the current value's directory when it
                // still exists; otherwise fall back to the OS default.
                ...(defaultPath && existsSync(defaultPath) ? { defaultPath } : {}),
            });
            if (result.canceled || result.filePaths.length === 0) {
                return undefined;
            }
            return result.filePaths[0];
        });

        ipcMain.handle('shell:showItemInFolder', (_event, path: string) => {
            shell.showItemInFolder(path);
        });
    }
}

export function createDialogHandlerModule() {
    return new DialogHandler();
}
