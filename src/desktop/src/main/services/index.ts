import type { BrowserWindow, IpcMain } from 'electron';
import { app, shell } from 'electron';

import { IpcChannel, type InitialCompareSession } from '@awapi/shared';

import { NotImplementedError } from './errors.js';
import { CliService } from './cliService.js';
import { DialogService, type DialogServiceDeps } from './dialogService.js';
import { DiffService } from './diffService.js';
import { FsCodedError, FsService } from './fsService.js';
import { HashService } from './hashService.js';
import { LicenseService } from './licenseService.js';
import { RulesService, type RulesServiceDeps } from './rulesService.js';
import { SessionService, type SessionServiceDeps } from './sessionService.js';
import { RecentsService, type RecentsServiceDeps } from './recentsService.js';
import { ShellIntegrationService } from './shellIntegrationService.js';
import { SftpService } from './sftpService.js';
import { UpdaterService } from './updaterService.js';

export { installApplicationMenu } from './menuService.js';

export interface Services {
  fs: FsService;
  hash: HashService;
  diff: DiffService;
  rules: RulesService;
  session: SessionService;
  recents: RecentsService;
  sftp: SftpService;
  license: LicenseService;
  updater: UpdaterService;
  cli: CliService;
  dialog: DialogService;
  shellIntegration: ShellIntegrationService;
  /**
   * Initial compare session injected from CLI args / env vars at
   * launch. The renderer reads this once on startup. `null` when the
   * app was launched without a folder pair.
   */
  initialCompare: InitialCompareSession | null;
}

export interface CreateServicesOptions {
  /** Persistence options for the global rules store. */
  rules?: RulesServiceDeps;
  /** Persistence options for the session store. */
  session?: SessionServiceDeps;
  /** Persistence options for the recents store. */
  recents?: RecentsServiceDeps;
  /** Optional overrides for the native dialog service (used by tests). */
  dialog?: DialogServiceDeps;
  /** Initial compare session from CLI parsing. */
  initialCompare?: InitialCompareSession | null;
  /** Shell integration service instance (created in main/index.ts). */
  shellIntegration?: ShellIntegrationService;
}

export function createServices(options: CreateServicesOptions = {}): Services {
  return {
    fs: new FsService(),
    hash: new HashService(),
    diff: new DiffService(),
    rules: new RulesService(options.rules),
    session: new SessionService(options.session),
    recents: new RecentsService(options.recents),
    sftp: new SftpService(),
    license: new LicenseService(),
    updater: new UpdaterService(),
    cli: new CliService(),
    dialog: new DialogService(options.dialog),
    shellIntegration: options.shellIntegration ?? new ShellIntegrationService(''),
    initialCompare: options.initialCompare ?? null,
  };
}

/**
 * Thin adapter that turns a `NotImplementedError` into a structured IPC
 * error instead of a cryptic rejection. Other exceptions bubble up
 * unchanged so we don't mask real bugs.
 */
function wrap<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return Promise.resolve(fn()).catch((err: unknown) => translateError(err));
  } catch (err) {
    return translateError(err);
  }
}

function translateError<T>(err: unknown): Promise<T> {
  if (err instanceof NotImplementedError) {
    return Promise.reject(
      Object.assign(new Error(err.message), { code: 'E_NOT_IMPLEMENTED', phase: err.phase }),
    );
  }
  if (err instanceof FsCodedError) {
    return Promise.reject(
      Object.assign(new Error(err.message), { code: err.code, ...(err.details ?? {}) }),
    );
  }
  return Promise.reject(err as Error);
}

/**
 * Register all `ipcMain.handle` callbacks. Must be called once after
 * `app.whenReady()`. A separate `attachProgressBridge` pipes scan
 * progress events back to the renderer via `webContents.send`.
 */
export function registerIpcHandlers(ipcMain: IpcMain, services: Services): void {
  const { fs, hash, rules, session, recents, license, updater } = services;

  ipcMain.handle(IpcChannel.FsScan, (_e, req) => wrap(() => fs.scan(req)));
  ipcMain.handle(IpcChannel.FsRead, (_e, req) => wrap(() => fs.read(req)));
  ipcMain.handle(IpcChannel.FsReadChunk, (_e, req) => wrap(() => fs.readChunk(req)));
  ipcMain.handle(IpcChannel.FsHash, (_e, path: string) => wrap(() => hash.hash(path)));
  ipcMain.handle(IpcChannel.FsStat, (_e, req) => wrap(() => fs.stat(req)));
  ipcMain.handle(IpcChannel.FsCopy, (_e, req) => wrap(() => fs.copy(req)));
  ipcMain.handle(IpcChannel.FsWrite, (_e, req) => wrap(() => fs.write(req)));
  ipcMain.handle(IpcChannel.FsRm, (_e, req) => wrap(() => fs.rm(req)));
  ipcMain.handle(IpcChannel.FsRename, (_e, req) => wrap(() => fs.rename(req)));

  ipcMain.handle(IpcChannel.SessionSave, (_e, s) => wrap(() => session.save(s)));
  ipcMain.handle(IpcChannel.SessionLoad, (_e, id: string) => wrap(() => session.load(id)));
  ipcMain.handle(IpcChannel.SessionList, () => wrap(() => session.list()));

  ipcMain.handle(IpcChannel.RulesGet, () => wrap(() => rules.get()));
  ipcMain.handle(IpcChannel.RulesSet, (_e, r) => wrap(() => rules.set(r)));
  ipcMain.handle(IpcChannel.RulesTest, (_e, req) => wrap(() => rules.test(req)));

  ipcMain.handle(IpcChannel.RecentsGet, () => wrap(() => recents.get()));
  ipcMain.handle(IpcChannel.RecentsSet, (_e, data) => wrap(() => recents.set(data)));

  ipcMain.handle(IpcChannel.LicenseStatus, () => wrap(() => license.status()));
  ipcMain.handle(IpcChannel.LicenseActivate, (_e, req) => wrap(() => license.activate(req)));
  ipcMain.handle(IpcChannel.LicenseDeactivate, () => wrap(() => license.deactivate()));

  ipcMain.handle(IpcChannel.UpdaterCheck, () => wrap(() => updater.check()));
  ipcMain.handle(IpcChannel.UpdaterDownload, () => wrap(() => updater.download()));
  ipcMain.handle(IpcChannel.UpdaterInstall, () => wrap(() => updater.install()));

  ipcMain.handle(IpcChannel.AppOpenExternal, (_e, url: string) =>
    shell.openExternal(url),
  );

  ipcMain.on(IpcChannel.AppRevealInFolder, (_e, path: string) => {
    shell.showItemInFolder(path);
  });

  ipcMain.handle(IpcChannel.AppGetInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
  }));

  // SFTP deferred to v1.1 — reserve channel, reject cleanly.
  ipcMain.handle(IpcChannel.SftpConnect, (_e, req) =>
    wrap(() => services.sftp.connect(req)),
  );

  ipcMain.handle(IpcChannel.DialogPickFolder, (_e, req) =>
    wrap(() => services.dialog.pickFolder(req)),
  );

  ipcMain.handle(IpcChannel.DialogPickFile, (_e, req) =>
    wrap(() => services.dialog.pickFile(req)),
  );

  ipcMain.handle(IpcChannel.DialogConfirmUnsaved, (_e, req) =>
    wrap(() => services.dialog.confirmUnsaved(req)),
  );

  ipcMain.handle(IpcChannel.AppGetInitialCompare, () => services.initialCompare);

  ipcMain.handle(IpcChannel.ShellIntegrationStatus, () =>
    wrap(() => services.shellIntegration.isRegistered()),
  );
  ipcMain.handle(IpcChannel.ShellIntegrationRegister, () =>
    wrap(() => services.shellIntegration.register(app.getPath('exe'))),
  );
  ipcMain.handle(IpcChannel.ShellIntegrationUnregister, () =>
    wrap(() => services.shellIntegration.unregister()),
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
