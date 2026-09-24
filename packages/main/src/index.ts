import type { AppInitConfig } from './AppInitConfig.js';
import { createModuleRunner } from './ModuleRunner.js';
import { disallowMultipleAppInstance } from './modules/SingleInstanceApp.js';
import { createWindowManagerModule } from './modules/WindowManager.js';
import { terminateAppOnLastWindowClose } from './modules/ApplicationTerminatorOnLastWindowClose.js';
import { hardwareAccelerationMode } from './modules/HardwareAccelerationModule.js';
import { autoUpdater } from './modules/AutoUpdater.js';
import { allowInternalOrigins } from './modules/BlockNotAllowdOrigins.js';
import { allowExternalUrls } from './modules/ExternalUrls.js';
import { createDialogHandlerModule } from './modules/DialogHandler.js';
import { createMuxerHandlerModule } from './modules/MuxerHandler.js';

export async function initApp(initConfig: AppInitConfig) {
    const moduleRunner = createModuleRunner()
        .init(createWindowManagerModule({ initConfig, openDevTools: import.meta.env.DEV }))
        .init(disallowMultipleAppInstance())
        .init(terminateAppOnLastWindowClose())
        .init(hardwareAccelerationMode({ enable: true }))
        .init(autoUpdater())
        .init(createDialogHandlerModule())
        .init(createMuxerHandlerModule())

    // Install DevTools extension if needed
    // .init(chromeDevToolsExtension({extension: 'VUEJS3_DEVTOOLS'}))

    // Security
        .init(allowInternalOrigins(
            new Set(initConfig.renderer instanceof URL ? [initConfig.renderer.origin] : []),
        ))
        // External origins the renderer may open via target=_blank, in dev and
        // packaged builds alike (the set used to be dev-only, which left the
        // Settings link to themoviedb.org dead in production).
        .init(allowExternalUrls(
            new Set(['https://www.themoviedb.org']),
        ));

    await moduleRunner;
}
