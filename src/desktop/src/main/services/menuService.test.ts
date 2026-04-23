import { describe, expect, it, vi } from 'vitest';

import { IpcChannel, type MenuAction } from '@awapi/shared';

import {
  buildMenuTemplate,
  installApplicationMenu,
  toElectronTemplate,
  type MenuNode,
} from './menuService.js';

function find(nodes: MenuNode[] | undefined, label: string): MenuNode | undefined {
  if (!nodes) return undefined;
  for (const n of nodes) {
    if (n.label === label) return n;
    const inner = find(n.submenu, label);
    if (inner) return inner;
  }
  return undefined;
}

function collectActions(nodes: MenuNode[]): MenuAction[] {
  const out: MenuAction[] = [];
  const walk = (ns: MenuNode[]): void => {
    for (const n of ns) {
      if (n.action) out.push(n.action);
      if (n.submenu) walk(n.submenu);
    }
  };
  walk(nodes);
  return out;
}

describe('buildMenuTemplate', () => {
  it('places the app menu first on macOS and omits it elsewhere', () => {
    const mac = buildMenuTemplate({ platform: 'darwin', appName: 'AwapiCompare', isDev: false });
    expect(mac[0]?.label).toBe('AwapiCompare');
    expect(mac[1]?.label).toBe('&File');

    const lin = buildMenuTemplate({ platform: 'linux', appName: 'AwapiCompare', isDev: false });
    expect(lin[0]?.label).toBe('&File');
    expect(lin.some((n) => n.label === 'AwapiCompare')).toBe(false);
  });

  it('emits every MenuAction from the shared contract at least once', () => {
    const template = buildMenuTemplate({ platform: 'darwin', appName: 'AwapiCompare', isDev: true });
    const actions = new Set(collectActions(template));
    const expected: MenuAction[] = [
      'session.new',
      'session.open',
      'session.save',
      'session.saveAs',
      'session.refresh',
      'session.closeTab',
      'edit.find',
      'edit.findNext',
      'edit.findPrev',
      'edit.preferences',
      'compare.copyLeftToRight',
      'compare.copyRightToLeft',
      'compare.markSame',
      'compare.exclude',
      'view.toggleTheme',
      'view.expandAll',
      'view.collapseAll',
      'help.docs',
      'help.checkForUpdates',
      'help.viewLicense',
      'help.about',
    ];
    for (const a of expected) expect(actions.has(a)).toBe(true);
  });

  it('assigns the documented hotkeys', () => {
    const t = buildMenuTemplate({ platform: 'linux', appName: 'AwapiCompare', isDev: false });
    expect(find(t, 'New Session')?.accelerator).toBe('CmdOrCtrl+N');
    expect(find(t, 'Open Session…')?.accelerator).toBe('CmdOrCtrl+O');
    expect(find(t, 'Save Session')?.accelerator).toBe('CmdOrCtrl+S');
    expect(find(t, 'Save Session As…')?.accelerator).toBe('CmdOrCtrl+Shift+S');
    expect(find(t, 'Refresh')?.accelerator).toBe('F5');
    expect(find(t, 'Find')?.accelerator).toBe('CmdOrCtrl+F');
    expect(find(t, 'Copy Left → Right')?.accelerator).toBe('Alt+Right');
    expect(find(t, 'Copy Right → Left')?.accelerator).toBe('Alt+Left');
    expect(find(t, 'Preferences…')?.accelerator).toBe('CmdOrCtrl+,');
  });

  it('places Preferences under the app menu on macOS (not under Edit)', () => {
    const t = buildMenuTemplate({ platform: 'darwin', appName: 'AwapiCompare', isDev: false });
    const edit = t.find((n) => n.label === '&Edit');
    expect(edit?.submenu?.some((n) => n.label === 'Preferences…')).toBe(false);
    const appMenu = t[0];
    expect(appMenu?.submenu?.some((n) => n.label === 'Preferences…')).toBe(true);
  });

  it('only exposes devtools / reload entries when isDev=true', () => {
    const prod = buildMenuTemplate({ platform: 'linux', appName: 'AwapiCompare', isDev: false });
    const dev = buildMenuTemplate({ platform: 'linux', appName: 'AwapiCompare', isDev: true });

    const roleEntries = (ns: MenuNode[]): string[] => {
      const out: string[] = [];
      const walk = (xs: MenuNode[]): void => {
        for (const n of xs) {
          if (n.role) out.push(String(n.role));
          if (n.submenu) walk(n.submenu);
        }
      };
      walk(ns);
      return out;
    };

    expect(roleEntries(prod)).not.toContain('toggleDevTools');
    expect(roleEntries(dev)).toContain('toggleDevTools');
    expect(roleEntries(dev)).toContain('reload');
  });

  it('keeps every action id in sync with the shared MenuAction union', () => {
    const t = buildMenuTemplate({ platform: 'darwin', appName: 'AwapiCompare', isDev: true });
    const allowed: MenuAction[] = [
      'session.new',
      'session.open',
      'session.save',
      'session.saveAs',
      'session.refresh',
      'session.closeTab',
      'edit.find',
      'edit.findNext',
      'edit.findPrev',
      'edit.preferences',
      'compare.copyLeftToRight',
      'compare.copyRightToLeft',
      'compare.markSame',
      'compare.exclude',
      'view.toggleTheme',
      'view.expandAll',
      'view.collapseAll',
      'help.docs',
      'help.checkForUpdates',
      'help.viewLicense',
      'help.about',
    ];
    for (const a of collectActions(t)) expect(allowed).toContain(a);
  });
});

describe('toElectronTemplate', () => {
  it('attaches click handlers that emit the node action', () => {
    const nodes: MenuNode[] = [
      { label: 'File', submenu: [{ label: 'New', action: 'session.new' }] },
    ];
    const emit = vi.fn();
    const out = toElectronTemplate(nodes, emit);

    const click = (out[0]?.submenu as Array<{ click?: () => void }>)[0]?.click;
    expect(typeof click).toBe('function');
    click?.();
    expect(emit).toHaveBeenCalledWith('session.new');
  });

  it('does not attach a click handler for role-only items', () => {
    const out = toElectronTemplate([{ role: 'copy' }], vi.fn());
    expect((out[0] as { click?: unknown }).click).toBeUndefined();
    expect(out[0]?.role).toBe('copy');
  });
});

describe('installApplicationMenu', () => {
  it('sends the emitted action over the AppMenuAction IPC channel', () => {
    const send = vi.fn();
    const getTargetWindow = vi.fn().mockReturnValue({
      isDestroyed: () => false,
      webContents: { send },
    });
    const setApplicationMenu = vi.fn();
    const buildFromTemplate = vi.fn().mockReturnValue({});
    const { emit } = installApplicationMenu(
      { Menu: { buildFromTemplate, setApplicationMenu }, getTargetWindow },
      { platform: 'linux', appName: 'AwapiCompare', isDev: false },
    );

    emit('help.about');
    expect(send).toHaveBeenCalledWith(IpcChannel.AppMenuAction, 'help.about');
    expect(setApplicationMenu).toHaveBeenCalledTimes(1);
    expect(buildFromTemplate).toHaveBeenCalledTimes(1);
  });

  it('no-ops when no target window is available', () => {
    const getTargetWindow = vi.fn().mockReturnValue(null);
    const { emit } = installApplicationMenu(
      {
        Menu: { buildFromTemplate: vi.fn().mockReturnValue({}), setApplicationMenu: vi.fn() },
        getTargetWindow,
      },
      { platform: 'linux', appName: 'AwapiCompare', isDev: false },
    );
    expect(() => emit('help.about')).not.toThrow();
  });

  it('does not send to a destroyed window', () => {
    const send = vi.fn();
    const getTargetWindow = vi.fn().mockReturnValue({
      isDestroyed: () => true,
      webContents: { send },
    });
    const { emit } = installApplicationMenu(
      {
        Menu: { buildFromTemplate: vi.fn().mockReturnValue({}), setApplicationMenu: vi.fn() },
        getTargetWindow,
      },
      { platform: 'linux', appName: 'AwapiCompare', isDev: false },
    );
    emit('help.about');
    expect(send).not.toHaveBeenCalled();
  });
});
