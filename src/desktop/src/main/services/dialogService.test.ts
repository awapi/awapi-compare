import { describe, expect, it, vi } from 'vitest';

import {
  DialogService,
  resolveDefaultPath,
  type DialogFsStat,
  type ShowOpenDialogFn,
} from './dialogService.js';

const dirStat: DialogFsStat = () => ({ isDirectory: () => true });

function makeShowOpenDialog(
  result: { canceled: boolean; filePaths: string[] },
): { fn: ShowOpenDialogFn; calls: Parameters<ShowOpenDialogFn>[] } {
  const calls: Parameters<ShowOpenDialogFn>[] = [];
  const fn: ShowOpenDialogFn = async (window, options) => {
    calls.push([window, options]);
    return result;
  };
  return { fn, calls };
}

describe('DialogService', () => {
  it('returns the first selected path when the user confirms', async () => {
    const { fn } = makeShowOpenDialog({ canceled: false, filePaths: ['/tmp/foo'] });
    const svc = new DialogService({ showOpenDialog: fn });
    await expect(svc.pickFolder()).resolves.toBe('/tmp/foo');
  });

  it('returns null when the user cancels', async () => {
    const { fn } = makeShowOpenDialog({ canceled: true, filePaths: [] });
    const svc = new DialogService({ showOpenDialog: fn });
    await expect(svc.pickFolder()).resolves.toBeNull();
  });

  it('returns null when no path is provided even if not canceled', async () => {
    const { fn } = makeShowOpenDialog({ canceled: false, filePaths: [] });
    const svc = new DialogService({ showOpenDialog: fn });
    await expect(svc.pickFolder()).resolves.toBeNull();
  });

  it('passes title, defaultPath and openDirectory properties to the dialog', async () => {
    const { fn, calls } = makeShowOpenDialog({ canceled: true, filePaths: [] });
    const svc = new DialogService({ showOpenDialog: fn, stat: dirStat });
    await svc.pickFolder({ defaultPath: '/home', title: 'Pick' });

    expect(calls).toHaveLength(1);
    const [, options] = calls[0]!;
    expect(options.defaultPath).toBe('/home');
    expect(options.title).toBe('Pick');
    expect(options.properties).toContain('openDirectory');
  });

  it('forwards the result of getTargetWindow as the dialog parent', async () => {
    const { fn, calls } = makeShowOpenDialog({ canceled: true, filePaths: [] });
    const sentinel = { id: 7 } as unknown as Electron.BrowserWindow;
    const getTargetWindow = vi.fn(() => sentinel);
    const svc = new DialogService({ showOpenDialog: fn, getTargetWindow, stat: dirStat });

    await svc.pickFolder();

    expect(getTargetWindow).toHaveBeenCalledTimes(1);
    expect(calls[0]![0]).toBe(sentinel);
  });

  it('walks up to an existing ancestor when defaultPath does not exist', async () => {
    const { fn, calls } = makeShowOpenDialog({ canceled: true, filePaths: [] });
    const stat: DialogFsStat = (path) => {
      if (path === '/existing') return { isDirectory: () => true };
      throw new Error('ENOENT');
    };
    const svc = new DialogService({ showOpenDialog: fn, stat });
    await svc.pickFolder({ defaultPath: '/existing/missing/deep' });

    const [, options] = calls[0]!;
    expect(options.defaultPath).toBe('/existing');
  });

  it('drops defaultPath when no existing ancestor is found', async () => {
    const { fn, calls } = makeShowOpenDialog({ canceled: true, filePaths: [] });
    const stat: DialogFsStat = () => {
      throw new Error('ENOENT');
    };
    const svc = new DialogService({ showOpenDialog: fn, stat });
    await svc.pickFolder({ defaultPath: '/no/where' });

    const [, options] = calls[0]!;
    expect(options.defaultPath).toBeUndefined();
  });
});

describe('resolveDefaultPath', () => {
  it('returns undefined for empty / whitespace input', () => {
    expect(resolveDefaultPath(undefined, dirStat)).toBeUndefined();
    expect(resolveDefaultPath('', dirStat)).toBeUndefined();
    expect(resolveDefaultPath('   ', dirStat)).toBeUndefined();
  });

  it('trims whitespace before resolving', () => {
    expect(resolveDefaultPath('  /tmp  ', dirStat)).toBe('/tmp');
  });

  it('resolves relative paths against the cwd', () => {
    const seen: string[] = [];
    const stat: DialogFsStat = (p) => {
      seen.push(p);
      return { isDirectory: () => true };
    };
    const out = resolveDefaultPath('relative/dir', stat);
    expect(out).toBeDefined();
    // The resolved path must be absolute.
    expect(out!.startsWith('/') || /^[A-Za-z]:[\\/]/.test(out!)).toBe(true);
    expect(seen[0]).toBe(out);
  });
});
