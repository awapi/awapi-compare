import { promises as fsPromises } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, Menu, app, ipcMain } from 'electron';

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
  });
  // Surface load errors via console; the service falls back to empty.
  await services.rules.get();
  registerIpcHandlers(ipcMain, services);
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
