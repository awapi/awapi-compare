import { promises as fsPromises } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, Menu, app, ipcMain } from 'electron';

import { IpcChannel, type InitialCompareSession } from '@awapi/shared';

import { parseDesktopArgs, type DesktopArgs } from './cliArgs.js';
import { MultiSelectCollector } from './multiSelectCollector.js';
import { resolveShellCompareType } from './shellCompareSession.js';
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

/**
 * The single primary application window. Tracked at module scope so
 * second-instance launches (Explorer multi-select compares funnelled
 * through the single-instance lock) can target and reveal it.
 */
let mainWindow: BrowserWindow | null = null;
/** True once the renderer mounted and subscribed to AppOpenCompare. */
let rendererReady = false;
/** Compare sessions resolved before the renderer was ready to receive them. */
const pendingCompares: InitialCompareSession[] = [];
/**
 * Routes a second-instance launch's argv into the running app. Assigned
 * once services exist during startup; a no-op until then.
 */
let routeSecondInstance: (argv: readonly string[]) => void = () => {};

/** Restore (if minimized), show and focus a window. */
function revealWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

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

  mainWindow = win;
  const detachProgress = attachProgressBridge(win, services);
  win.on('closed', () => {
    detachProgress();
    if (mainWindow === win) {
      mainWindow = null;
      rendererReady = false;
    }
  });

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

/** Parse argv defensively; log and treat parse failures as "no args". */
function safeParseArgs(argv: readonly string[]): DesktopArgs {
  try {
    // Skip the executable + script paths in `argv`. In packaged builds
    // argv[0] is the Electron binary and argv[1+] are user args; in
    // `electron-vite dev` the same shape holds.
    return parseDesktopArgs(argv.slice(1) as string[]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[awapi] CLI argument error: ${msg}`);
    return null;
  }
}

const startupArgs = safeParseArgs(process.argv);

// Short-lived "fire and quit" verbs must run standalone (they don't open
// a window): they write registry/pending state and exit. Everything else
// is a GUI/compare launch that should funnel into ONE app instance so
// Explorer's per-item multi-select launches collapse into a single window
// (and a second compare opens a new tab, not a new process).
const isFireAndQuit =
  startupArgs?.kind === 'registerShell' ||
  startupArgs?.kind === 'unregisterShell' ||
  startupArgs?.kind === 'setLeft';

const hasInstanceLock = isFireAndQuit || app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  // Another instance owns the app and will receive our argv via the
  // primary's 'second-instance' handler. Quit immediately.
  app.quit();
}
if (hasInstanceLock && !isFireAndQuit) {
  app.on('second-instance', (_event, argv) => routeSecondInstance(argv));
}

void app.whenReady().then(async () => {
  // Secondary instances bail out here (the primary handles their argv).
  if (!hasInstanceLock) return;

  const userDataPath = app.getPath('userData');
  const shellIntegration = new ShellIntegrationService(userDataPath);

  let args: DesktopArgs = startupArgs;

  // --- Single-instance compare routing ---------------------------------
  // Buffers Explorer's per-item multi-select launches and pairs them.
  const collector = new MultiSelectCollector({
    onResolve: (paths) => void onCollected(paths),
  });

  /** Send a compare session to the renderer, or queue it until ready. */
  function pushCompare(session: InitialCompareSession): void {
    const win = mainWindow;
    if (win && !win.isDestroyed() && rendererReady) {
      revealWindow(win);
      win.webContents.send(IpcChannel.AppOpenCompare, session);
    } else {
      pendingCompares.push(session);
    }
  }

  /** Resolve a collected batch of single paths into one comparison. */
  async function onCollected(paths: readonly string[]): Promise<void> {
    if (paths.length >= 2) {
      const leftPath = paths[0] as string;
      const rightPath = paths[1] as string;
      const pairType = await resolveShellCompareType(leftPath, rightPath);
      if (pairType) {
        pushCompare({ type: pairType, leftRoot: leftPath, rightRoot: rightPath, mode: 'quick' });
      } else {
        console.warn(
          `[awapi] multi-select rejected mixed/unsupported pair: '${leftPath}' vs '${rightPath}'`,
        );
        pushCompare({ type: 'folder', leftRoot: leftPath, mode: 'quick' });
      }
      return;
    }
    const only = paths[0];
    if (only) pushCompare({ type: 'folder', leftRoot: only, mode: 'quick' });
  }

  /** Route a (second-instance) launch's parsed args into the running app. */
  async function routeArgs(a: DesktopArgs): Promise<void> {
    if (!a) {
      if (mainWindow) revealWindow(mainWindow);
      return;
    }
    switch (a.kind) {
      case 'compareAdd':
        collector.add(a.path);
        return;
      case 'setLeft':
        try {
          await shellIntegration.setPendingLeft(a.path);
        } catch (err) {
          console.error('[awapi] set-left failed:', err);
        }
        return;
      case 'comparePending': {
        const pendingLeft = await shellIntegration.getPendingLeft();
        if (!pendingLeft) {
          pushCompare({ type: 'folder', leftRoot: a.rightPath, mode: 'quick' });
          return;
        }
        const pairType = await resolveShellCompareType(pendingLeft, a.rightPath);
        if (pairType) {
          await shellIntegration.clearPendingLeft();
          pushCompare({
            type: pairType,
            leftRoot: pendingLeft,
            rightRoot: a.rightPath,
            mode: 'quick',
          });
        } else {
          pushCompare({ type: 'folder', leftRoot: a.rightPath, mode: 'quick' });
        }
        return;
      }
      case 'compareTwo': {
        const pairType = await resolveShellCompareType(a.leftPath, a.rightPath);
        if (pairType) {
          pushCompare({
            type: pairType,
            leftRoot: a.leftPath,
            rightRoot: a.rightPath,
            mode: 'quick',
          });
        } else {
          pushCompare({ type: 'folder', leftRoot: a.leftPath, mode: 'quick' });
        }
        return;
      }
      case 'compare':
        pushCompare(a.session);
        return;
      case 'openLeft':
        pushCompare({ type: 'folder', leftRoot: a.path, mode: 'quick' });
        return;
      default:
        if (mainWindow) revealWindow(mainWindow);
    }
  }

  routeSecondInstance = (argv) => void routeArgs(safeParseArgs(argv));

  // --register-shell / --unregister-shell: manage Explorer context menu entries.
  if (args?.kind === 'registerShell') {
    try {
      await shellIntegration.register(app.getPath('exe'));
      // eslint-disable-next-line no-console
      console.log('[awapi] Shell integration registered');
    } catch (err) {
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

  // --set-left: stash the path and quit (no window). Used by the
  // Explorer "Select as Left Side" context-menu verb.
  if (args?.kind === 'setLeft') {
    try {
      await shellIntegration.setPendingLeft(args.path);
      // eslint-disable-next-line no-console
      console.log(`[awapi] pending left set: ${args.path}`);
    } catch (err) {
      console.error('[awapi] failed to write pending-left:', err);
    }
    app.quit();
    return;
  }

  // --compare-pending: read stashed left, open comparison, clear stash.
  if (args?.kind === 'comparePending') {
    const { rightPath } = args;
    const pendingLeft = await shellIntegration.getPendingLeft();
    if (pendingLeft) {
      const pairType = await resolveShellCompareType(pendingLeft, rightPath);
      if (pairType) {
        await shellIntegration.clearPendingLeft();
        console.log(`[awapi] compare-pending: '${pendingLeft}' ↔ '${rightPath}'`);
        args = {
          kind: 'compare',
          session: {
            type: pairType,
            leftRoot: pendingLeft,
            rightRoot: rightPath,
            mode: 'quick',
          },
        };
      } else {
        console.warn(
          `[awapi] compare-pending rejected mixed/unsupported pair: '${pendingLeft}' vs '${rightPath}'`,
        );
        args = { kind: 'openLeft', path: rightPath };
      }
    } else {
      console.warn('[awapi] compare-pending invoked with no pending left stashed');
      args = { kind: 'openLeft', path: rightPath };
    }
    // Fall through to normal flow — args is now either 'compare' or 'openLeft'.
  }

  // --compare-two: multi-select from Explorer — compare two items directly.
  if (args?.kind === 'compareTwo') {
    const { leftPath, rightPath } = args;
    const pairType = await resolveShellCompareType(leftPath, rightPath);
    if (pairType) {
      console.log(`[awapi] compare-two: '${leftPath}' ↔ '${rightPath}'`);
      args = {
        kind: 'compare',
        session: {
          type: pairType,
          leftRoot: leftPath,
          rightRoot: rightPath,
          mode: 'quick',
        },
      };
    } else {
      console.warn(
        `[awapi] compare-two rejected mixed/unsupported pair: '${leftPath}' vs '${rightPath}'`,
      );
      args = { kind: 'openLeft', path: leftPath };
    }
    // Fall through to normal flow.
  }

  // --compare-add: a single item from Explorer's multi-select "Compare
  // with AwapiCompare" verb. Buffer it; the collector pairs it with the
  // sibling launch(es) funnelled through the single-instance lock and
  // opens exactly one comparison (see onCollected / pushCompare).
  if (args?.kind === 'compareAdd') {
    collector.add(args.path);
    args = null;
  }

  // Resolve the initial compare session.
  let initialCompare: InitialCompareSession | null = null;

  if (args?.kind === 'openLeft') {
    // --left without --right: open app with left side pre-populated, right empty.
    initialCompare = { type: 'folder', leftRoot: args.path, mode: 'quick' };
    // eslint-disable-next-line no-console
    console.log(`[awapi] opening with left side: ${args.path}`);
  } else if (args?.kind === 'compare') {
    const session = args.session;
    initialCompare = session;
    // eslint-disable-next-line no-console
    console.log(
      `[awapi] launching with ${session.type} compare: ` +
        `${session.leftRoot} ↔ ${session.rightRoot} (${session.mode})`,
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

  // Renderer finished mounting and subscribed to AppOpenCompare. Flush any
  // compare sessions that resolved before it was ready (e.g. a multi-select
  // compare that settled during window startup).
  ipcMain.on(IpcChannel.AppRendererReady, (event) => {
    rendererReady = true;
    while (pendingCompares.length > 0) {
      const session = pendingCompares.shift();
      if (session) event.sender.send(IpcChannel.AppOpenCompare, session);
    }
  });
  // eslint-disable-next-line no-console
  console.log('[awapi] IPC handlers registered');
  // Best-effort: warm the rules cache. Failures here are non-fatal.
  try {
    await services.rules.get();
  } catch (err) {
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
  mainWindow = createMainWindow(services);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow(services);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
