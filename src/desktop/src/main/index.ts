import { promises as fsPromises } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, Menu, app, ipcMain } from 'electron';

import type { InitialCompareSession } from '@awapi/shared';

import { parseDesktopArgs } from './cliArgs.js';
import {
  attachProgressBridge,
  createServices,
  installApplicationMenu,
  registerIpcHandlers,
  type Services,
} from './services/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function createMainWindow(services: Services): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    title: 'AwapiCompare',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  const detachProgress = attachProgressBridge(win, services);
  win.on('closed', detachProgress);

  win.once('ready-to-show', () => win.show());

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

void app.whenReady().then(async () => {
  const rulesFile = join(app.getPath('userData'), 'rules.json');
  let initialCompare: InitialCompareSession | null = null;
  try {
    // Skip the executable + script paths in `process.argv`. In packaged
    // builds argv[0] is the Electron binary and argv[1+] are user args;
    // in `electron-vite dev` the same shape holds.
    initialCompare = parseDesktopArgs(process.argv.slice(1));
    if (initialCompare) {
      // eslint-disable-next-line no-console
      console.log(
        `[awapi] launching with ${initialCompare.type} compare: ` +
          `${initialCompare.leftRoot} ↔ ${initialCompare.rightRoot} (${initialCompare.mode})`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[awapi] CLI argument error: ${msg}`);
  }
  const services = createServices({
    rules: {
      filePath: rulesFile,
      dirPath: dirname(rulesFile),
      fs: fsPromises,
    },
    dialog: {
      getTargetWindow: () =>
        BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
    },
    initialCompare,
  });
  // Register IPC handlers BEFORE any potentially-failing async work so a
  // bad rules.json on disk can never leave handlers un-registered (which
  // would surface to the renderer as "No handler registered for ...").
  registerIpcHandlers(ipcMain, services);
  // eslint-disable-next-line no-console
  console.log('[awapi] IPC handlers registered');
  // Best-effort: warm the rules cache. Failures here are non-fatal.
  try {
    await services.rules.get();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[awapi] rules.get() failed on startup:', err);
  }
  installApplicationMenu(
    {
      Menu,
      getTargetWindow: () =>
        BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
    },
    {
      platform: process.platform,
      appName: app.getName(),
      isDev: process.env['ELECTRON_RENDERER_URL'] !== undefined,
    },
  );
  createMainWindow(services);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(services);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
