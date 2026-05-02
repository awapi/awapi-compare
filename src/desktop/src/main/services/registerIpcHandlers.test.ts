import { describe, expect, it, vi } from 'vitest';

import { IpcChannel } from '@awapi/shared';

import { createServices, registerIpcHandlers } from './index.js';

interface Handler {
  (event: unknown, ...args: unknown[]): unknown;
}

function fakeIpcMain() {
  const handlers = new Map<string, Handler>();
  const onListeners = new Map<string, Handler>();
  return {
    handle: vi.fn((channel: string, handler: Handler) => {
      if (handlers.has(channel)) throw new Error(`double-registered: ${channel}`);
      handlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: Handler) => {
      onListeners.set(channel, handler);
    }),
    invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
      const h = handlers.get(channel);
      if (!h) throw new Error(`no handler for ${channel}`);
      return h({}, ...args);
    },
    channels: (): string[] => [...handlers.keys()],
  };
}

describe('registerIpcHandlers', () => {
  it('wires every renderer-invoked IPC channel exactly once', () => {
    const mockIpc = fakeIpcMain();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerIpcHandlers(mockIpc as any, createServices());

    const expected = Object.values(IpcChannel).filter(
      (c) =>
        // Push-only / non-invoke channels (handled separately).
        c !== IpcChannel.FsScanProgress &&
        c !== IpcChannel.AppMenuAction &&
        c !== IpcChannel.AppRequestClose &&
        c !== IpcChannel.AppCloseWindow &&
        // Fire-and-forget send channel (uses ipcMain.on, not handle).
        c !== IpcChannel.AppRevealInFolder,
    );
    expect(mockIpc.channels().sort()).toEqual([...expected].sort());
  });

  it('translates NotImplementedError into an E_NOT_IMPLEMENTED IPC error', async () => {
    const mockIpc = fakeIpcMain();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerIpcHandlers(mockIpc as any, createServices());

    await expect(
      mockIpc.invoke(IpcChannel.UpdaterDownload),
    ).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED', phase: 'Phase 9' });
  });

  it('returns skeleton values for handlers that are already functional', async () => {
    const mockIpc = fakeIpcMain();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerIpcHandlers(mockIpc as any, createServices());

    await expect(mockIpc.invoke(IpcChannel.LicenseStatus)).resolves.toEqual({ state: 'invalid' });
    await expect(mockIpc.invoke(IpcChannel.UpdaterCheck)).resolves.toEqual({ available: false });
    await expect(mockIpc.invoke(IpcChannel.RulesGet)).resolves.toEqual([]);
    await expect(mockIpc.invoke(IpcChannel.SessionList)).resolves.toEqual([]);
  });
});
