import { promises as fsPromises } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, Menu, app, ipcMain } from 'electron';

import { IpcChannel, type InitialCompareSession } from '@awapi/shared';

import { parseDesktopArgs } from './cliArgs.js';
import {
  attachProgressBridge,
  createServices,
  installApplicationMenu,
  registerIpcHandlers,
  type Services,
} from './services/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Tracks per-window "the renderer has confirmed it's safe to close
 * any unsaved changes". Set by the `app.closeWindow` IPC; consulted
 * by the `close` handler so the second close (after the user clicked
 * Save / Don't Save) goes through unimpeded.
 */
const closeApprovedWindows = new WeakSet<BrowserWindow>();

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

  // Intercept the first close attempt so the renderer can prompt the
  // user about any unsaved changes. The renderer either calls back
  // via `app.closeWindow` (which sets the approval flag and we let
  // the second close go through) or simply does nothing (cancel).
  win.on('close', (event) => {
    if (closeApprovedWindows.has(win)) return;
    if (win.webContents.isDestroyed()) return;
    event.preventDefault();
    win.webContents.send(IpcChannel.AppRequestClose);
  });

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

  // Renderer signals "user has resolved unsaved-changes prompts; go
  // ahead and close the window". We mark the sender's window as
  // approved so the next `close` handler doesn't re-prompt.
  ipcMain.on(IpcChannel.AppCloseWindow, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    closeApprovedWindows.add(win);
    win.close();
  });
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
