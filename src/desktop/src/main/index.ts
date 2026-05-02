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
import { ShellIntegrationService } from './services/shellIntegrationService.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Tracks per-window "the renderer has confirmed it's safe to close
 * any unsaved changes". Set by the `app.closeWindow` IPC; consulted
 * by the `close` handler so the second close (after the user clicked
 * Save / Don't Save) goes through unimpeded.
 */
const closeApprovedWindows = new WeakSet<BrowserWindow>();

// Resolves to <repo>/resources/icon.png both in dev (electron-vite serves
// the main process from src/desktop/out/main) and in packaged builds
// where electron-builder copies resources/ next to the app bundle.
// On macOS and Windows, electron-builder uses icon.icns / icon.ico for
// the OS-level app icon; this PNG is the in-process window/dock icon
// used during development and on Linux.
const APP_ICON_PATH = join(__dirname, '../../../../resources/icon.png');

function createMainWindow(services: Services): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    title: 'AwapiCompare',
    icon: APP_ICON_PATH,
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
  const userDataPath = app.getPath('userData');
  const shellIntegration = new ShellIntegrationService(userDataPath);

  let args = null;
  try {
    // Skip the executable + script paths in `process.argv`. In packaged
    // builds argv[0] is the Electron binary and argv[1+] are user args;
    // in `electron-vite dev` the same shape holds.
    args = parseDesktopArgs(process.argv.slice(1));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[awapi] CLI argument error: ${msg}`);
  }

  // --register-shell / --unregister-shell: manage Explorer context menu entries.
  if (args?.kind === 'registerShell') {
    try {
      await shellIntegration.register(app.getPath('exe'));
      // eslint-disable-next-line no-console
      console.log('[awapi] Shell integration registered');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[awapi] Shell integration registration failed:', err);
    }
    app.quit();
    return;
  }
  if (args?.kind === 'unregisterShell') {
    await shellIntegration.unregister();
    // eslint-disable-next-line no-console
    console.log('[awapi] Shell integration unregistered');
    app.quit();
    return;
  }

  // Resolve the initial compare session.
  let initialCompare: InitialCompareSession | null = null;

  if (args?.kind === 'openLeft') {
    // --left without --right: open app with left side pre-populated, right empty.
    initialCompare = { type: 'folder', leftRoot: args.path, mode: 'quick' };
    // eslint-disable-next-line no-console
    console.log(`[awapi] opening with left side: ${args.path}`);
  } else if (args?.kind === 'compare') {
    initialCompare = args.session;
    // eslint-disable-next-line no-console
    console.log(
      `[awapi] launching with ${initialCompare.type} compare: ` +
        `${initialCompare.leftRoot} ↔ ${initialCompare.rightRoot} (${initialCompare.mode})`,
    );
  }

  const rulesFile = join(userDataPath, 'rules.json');
  const sessionsDir = join(userDataPath, 'sessions');
  const recentsFile = join(userDataPath, 'recents.json');
  const services = createServices({
    rules: {
      filePath: rulesFile,
      dirPath: dirname(rulesFile),
      fs: fsPromises,
    },
    session: {
      dirPath: sessionsDir,
      fs: fsPromises,
    },
    recents: {
      filePath: recentsFile,
      dirPath: userDataPath,
      fs: fsPromises,
    },
    dialog: {
      getTargetWindow: () =>
        BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
    },
    initialCompare,
    shellIntegration,
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
