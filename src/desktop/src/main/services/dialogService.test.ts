import { describe, expect, it, vi } from 'vitest';

import { DialogService, type ShowOpenDialogFn } from './dialogService.js';

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
    const svc = new DialogService({ showOpenDialog: fn });
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
    const svc = new DialogService({ showOpenDialog: fn, getTargetWindow });

    await svc.pickFolder();

    expect(getTargetWindow).toHaveBeenCalledTimes(1);
    expect(calls[0]![0]).toBe(sentinel);
  });
});
