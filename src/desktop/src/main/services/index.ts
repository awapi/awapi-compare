import type { BrowserWindow, IpcMain } from 'electron';

import { IpcChannel } from '@awapi/shared';

import { NotImplementedError } from './errors.js';
import { CliService } from './cliService.js';
import { DialogService, type DialogServiceDeps } from './dialogService.js';
import { DiffService } from './diffService.js';
import { FsService } from './fsService.js';
import { HashService } from './hashService.js';
import { LicenseService } from './licenseService.js';
import { RulesService, type RulesServiceDeps } from './rulesService.js';
import { SessionService } from './sessionService.js';
import { SftpService } from './sftpService.js';
import { UpdaterService } from './updaterService.js';

export { installApplicationMenu } from './menuService.js';

export interface Services {
  fs: FsService;
  hash: HashService;
  diff: DiffService;
  rules: RulesService;
  session: SessionService;
  sftp: SftpService;
  license: LicenseService;
  updater: UpdaterService;
  cli: CliService;
  dialog: DialogService;
}

export interface CreateServicesOptions {
  /** Persistence options for the global rules store. */
  rules?: RulesServiceDeps;
  /** Optional overrides for the native dialog service (used by tests). */
  dialog?: DialogServiceDeps;
}

export function createServices(options: CreateServicesOptions = {}): Services {
  return {
    fs: new FsService(),
    hash: new HashService(),
    diff: new DiffService(),
    rules: new RulesService(options.rules),
    session: new SessionService(),
    sftp: new SftpService(),
    license: new LicenseService(),
    updater: new UpdaterService(),
    cli: new CliService(),
    dialog: new DialogService(options.dialog),
  };
}

/**
 * Thin adapter that turns a `NotImplementedError` into a structured IPC
 * error instead of a cryptic rejection. Other exceptions bubble up
 * unchanged so we don't mask real bugs.
 */
function wrap<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    if (err instanceof NotImplementedError) {
      return Promise.reject(
        Object.assign(new Error(err.message), { code: 'E_NOT_IMPLEMENTED', phase: err.phase }),
      );
    }
    return Promise.reject(err as Error);
  }
}

/**
 * Register all `ipcMain.handle` callbacks. Must be called once after
 * `app.whenReady()`. A separate `attachProgressBridge` pipes scan
 * progress events back to the renderer via `webContents.send`.
 */
export function registerIpcHandlers(ipcMain: IpcMain, services: Services): void {
  const { fs, hash, rules, session, license, updater } = services;

  ipcMain.handle(IpcChannel.FsScan, (_e, req) => wrap(() => fs.scan(req)));
  ipcMain.handle(IpcChannel.FsReadChunk, (_e, req) => wrap(() => fs.readChunk(req)));
  ipcMain.handle(IpcChannel.FsHash, (_e, path: string) => wrap(() => hash.hash(path)));
  ipcMain.handle(IpcChannel.FsCopy, (_e, req) => wrap(() => fs.copy(req)));
  ipcMain.handle(IpcChannel.FsWrite, (_e, req) => wrap(() => fs.write(req)));

  ipcMain.handle(IpcChannel.SessionSave, (_e, s) => wrap(() => session.save(s)));
  ipcMain.handle(IpcChannel.SessionLoad, (_e, id: string) => wrap(() => session.load(id)));
  ipcMain.handle(IpcChannel.SessionList, () => wrap(() => session.list()));

  ipcMain.handle(IpcChannel.RulesGet, () => wrap(() => rules.get()));
  ipcMain.handle(IpcChannel.RulesSet, (_e, r) => wrap(() => rules.set(r)));
  ipcMain.handle(IpcChannel.RulesTest, (_e, req) => wrap(() => rules.test(req)));

  ipcMain.handle(IpcChannel.LicenseStatus, () => wrap(() => license.status()));
  ipcMain.handle(IpcChannel.LicenseActivate, (_e, req) => wrap(() => license.activate(req)));
  ipcMain.handle(IpcChannel.LicenseDeactivate, () => wrap(() => license.deactivate()));

  ipcMain.handle(IpcChannel.UpdaterCheck, () => wrap(() => updater.check()));
  ipcMain.handle(IpcChannel.UpdaterDownload, () => wrap(() => updater.download()));
  ipcMain.handle(IpcChannel.UpdaterInstall, () => wrap(() => updater.install()));

  // SFTP deferred to v1.1 — reserve channel, reject cleanly.
  ipcMain.handle(IpcChannel.SftpConnect, (_e, req) =>
    wrap(() => services.sftp.connect(req)),
  );

  ipcMain.handle(IpcChannel.DialogPickFolder, (_e, req) =>
    wrap(() => services.dialog.pickFolder(req)),
  );
}

/**
 * Pipes `FsService` scan progress to the given `BrowserWindow`'s renderer.
 * Returns an unsubscribe function; call it when the window is destroyed.
 */
export function attachProgressBridge(window: BrowserWindow, services: Services): () => void {
  return services.fs.onScanProgress((progress) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannel.FsScanProgress, progress);
    }
  });
}
