import type { BrowserWindow, Menu as ElectronMenu, MenuItemConstructorOptions } from 'electron';

import { IpcChannel, type MenuAction } from '@awapi/shared';

/**
 * Platform-agnostic description of a menu item. Staying free of any
 * `electron` runtime import keeps the builder pure and unit-testable
 * without the `electron` module loaded.
 *
 * - `action`: emits a typed `MenuAction` to the focused renderer.
 * - `role` : delegates to Electron's built-in behaviour (copy, paste…).
 * - Either `action` or `role` — never both.
 */
export interface MenuNode {
  label?: string;
  accelerator?: string;
  role?: MenuItemConstructorOptions['role'];
  action?: MenuAction;
  type?: 'normal' | 'separator' | 'submenu';
  submenu?: MenuNode[];
  visible?: boolean;
  enabled?: boolean;
}

export interface BuildMenuOptions {
  platform: NodeJS.Platform;
  appName: string;
  isDev: boolean;
}

/** Common `cmd` on macOS, `ctrl` elsewhere. Electron accepts `CmdOrCtrl`. */
const mod = 'CmdOrCtrl';

/**
 * Pure function — produces the menu template from platform + flags only.
 * Emits no side effects. Tested directly in `menuService.test.ts`.
 */
export function buildMenuTemplate(opts: BuildMenuOptions): MenuNode[] {
  const { platform, appName, isDev } = opts;
  const isMac = platform === 'darwin';

  const fileMenu: MenuNode = {
    label: '&File',
    submenu: [
      { label: 'New Session', accelerator: `${mod}+N`, action: 'session.new' },
      { label: 'Open Session…', accelerator: `${mod}+O`, action: 'session.open' },
      { type: 'separator' },
      { label: 'Save Session', accelerator: `${mod}+S`, action: 'session.save' },
      { label: 'Save Session As…', accelerator: `${mod}+Shift+S`, action: 'session.saveAs' },
      { type: 'separator' },
      { label: 'Refresh', accelerator: 'F5', action: 'session.refresh' },
      { label: 'Close Tab', accelerator: `${mod}+W`, action: 'session.closeTab' },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };

  const editMenu: MenuNode = {
    label: '&Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Find', accelerator: `${mod}+F`, action: 'edit.find' },
      { label: 'Find Next', accelerator: `${mod}+G`, action: 'edit.findNext' },
      { label: 'Find Previous', accelerator: `${mod}+Shift+G`, action: 'edit.findPrev' },
      { type: 'separator' },
      { label: 'Copy Left → Right', accelerator: 'Alt+Right', action: 'compare.copyLeftToRight' },
      { label: 'Copy Right → Left', accelerator: 'Alt+Left', action: 'compare.copyRightToLeft' },
      { label: 'Mark as Same', accelerator: `${mod}+M`, action: 'compare.markSame' },
      { label: 'Exclude', accelerator: `${mod}+E`, action: 'compare.exclude' },
      // On macOS, Preferences lives under the app menu; hide it here.
      ...(isMac
        ? []
        : ([
            { type: 'separator' as const },
            { label: 'Preferences…', accelerator: `${mod}+,`, action: 'edit.preferences' },
          ] satisfies MenuNode[])),
    ],
  };

  const viewMenu: MenuNode = {
    label: '&View',
    submenu: [
      { label: 'Expand All', accelerator: `${mod}+Shift+E`, action: 'view.expandAll' },
      { label: 'Collapse All', accelerator: `${mod}+Shift+C`, action: 'view.collapseAll' },
      { type: 'separator' },
      { label: 'Toggle Theme', accelerator: `${mod}+Shift+T`, action: 'view.toggleTheme' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(isDev
        ? ([{ type: 'separator' as const }, { role: 'reload' }, { role: 'toggleDevTools' }] satisfies MenuNode[])
        : []),
    ],
  };

  const helpMenu: MenuNode = {
    role: 'help',
    label: '&Help',
    submenu: [
      { label: 'Documentation', action: 'help.docs' },
      { label: 'Check for Updates…', action: 'help.checkForUpdates' },
      { label: 'View License', action: 'help.viewLicense' },
      ...(isMac
        ? []
        : ([
            { type: 'separator' as const },
            { label: `About ${appName}`, action: 'help.about' },
          ] satisfies MenuNode[])),
    ],
  };

  const macAppMenu: MenuNode = {
    label: appName,
    submenu: [
      { label: `About ${appName}`, action: 'help.about' },
      { type: 'separator' },
      { label: 'Preferences…', accelerator: `${mod}+,`, action: 'edit.preferences' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  return isMac
    ? [macAppMenu, fileMenu, editMenu, viewMenu, helpMenu]
    : [fileMenu, editMenu, viewMenu, helpMenu];
}

/**
 * Converts the plain `MenuNode` template into Electron's runtime
 * template, attaching click handlers that dispatch `MenuAction`s via
 * the provided emitter. Kept separate from `buildMenuTemplate` so the
 * builder remains pure.
 */
export function toElectronTemplate(
  nodes: MenuNode[],
  emit: (action: MenuAction) => void,
): MenuItemConstructorOptions[] {
  return nodes.map((n) => {
    const item: MenuItemConstructorOptions = {};
    if (n.label !== undefined) item.label = n.label;
    if (n.accelerator !== undefined) item.accelerator = n.accelerator;
    if (n.role !== undefined) item.role = n.role;
    if (n.type !== undefined) item.type = n.type;
    if (n.visible !== undefined) item.visible = n.visible;
    if (n.enabled !== undefined) item.enabled = n.enabled;
    if (n.submenu) item.submenu = toElectronTemplate(n.submenu, emit);
    if (n.action) {
      const action = n.action;
      item.click = (): void => emit(action);
    }
    return item;
  });
}

export interface MenuDeps {
  /** `() => import('electron').Menu` — injected for testability. */
  Menu: {
    buildFromTemplate(template: MenuItemConstructorOptions[]): ElectronMenu;
    setApplicationMenu(menu: ElectronMenu | null): void;
  };
  /**
   * Returns the window that should receive the action. Typically the
   * focused window; falls back to the given `defaultWindow`.
   */
  getTargetWindow: () => BrowserWindow | null;
}

/**
 * Installs the application menu and returns the emitter that would be
 * dispatched for a given action. Wire this from `main/index.ts`.
 */
export function installApplicationMenu(deps: MenuDeps, opts: BuildMenuOptions): {
  menu: ElectronMenu;
  emit: (action: MenuAction) => void;
} {
  const emit = (action: MenuAction): void => {
    const win = deps.getTargetWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannel.AppMenuAction, action);
    }
  };
  const template = toElectronTemplate(buildMenuTemplate(opts), emit);
  const menu = deps.Menu.buildFromTemplate(template);
  deps.Menu.setApplicationMenu(menu);
  return { menu, emit };
}
