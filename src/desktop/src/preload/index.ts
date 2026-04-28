import { contextBridge, ipcRenderer } from 'electron';
import type {
  AwapiApi,
  DialogConfirmUnsavedChoice,
  DialogConfirmUnsavedRequest,
  DialogPickFileRequest,
  DialogPickFolderRequest,
  FsCopyRequest,
  FsCopyResult,
  FsReadChunkRequest,
  FsReadRequest,
  FsReadResult,
  FsRenameRequest,
  FsRmRequest,
  FsRmResult,
  FsScanRequest,
  FsScanResult,
  FsStatRequest,
  FsStatResult,
  FsWriteRequest,
  InitialCompareSession,
  LicenseActivateRequest,
  LicenseStatus,
  MenuAction,
  Rule,
  RulesTestRequest,
  RulesTestResponse,
  ScanProgress,
  Session,
} from '@awapi/shared';
import { IpcChannel } from '@awapi/shared';

const api: AwapiApi = {
  fs: {
    scan: (req: FsScanRequest): Promise<FsScanResult> =>
      ipcRenderer.invoke(IpcChannel.FsScan, req),
    read: (req: FsReadRequest): Promise<FsReadResult> =>
      ipcRenderer.invoke(IpcChannel.FsRead, req),
    readChunk: (req: FsReadChunkRequest): Promise<Uint8Array> =>
      ipcRenderer.invoke(IpcChannel.FsReadChunk, req),
    hash: (path: string): Promise<string> => ipcRenderer.invoke(IpcChannel.FsHash, path),
    stat: (req: FsStatRequest): Promise<FsStatResult> =>
      ipcRenderer.invoke(IpcChannel.FsStat, req),
    rm: (req: FsRmRequest): Promise<FsRmResult> =>
      ipcRenderer.invoke(IpcChannel.FsRm, req),
    rename: (req: FsRenameRequest): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.FsRename, req),
    copy: (req: FsCopyRequest): Promise<FsCopyResult> =>
      ipcRenderer.invoke(IpcChannel.FsCopy, req),
    write: (req: FsWriteRequest): Promise<void> => ipcRenderer.invoke(IpcChannel.FsWrite, req),
    onScanProgress: (cb: (p: ScanProgress) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, p: ScanProgress): void => cb(p);
      ipcRenderer.on(IpcChannel.FsScanProgress, listener);
      return () => ipcRenderer.removeListener(IpcChannel.FsScanProgress, listener);
    },
  },
  session: {
    save: (s: Session): Promise<void> => ipcRenderer.invoke(IpcChannel.SessionSave, s),
    load: (id: string): Promise<Session | null> =>
      ipcRenderer.invoke(IpcChannel.SessionLoad, id),
    list: (): Promise<Session[]> => ipcRenderer.invoke(IpcChannel.SessionList),
  },
  rules: {
    get: (): Promise<Rule[]> => ipcRenderer.invoke(IpcChannel.RulesGet),
    set: (rules: Rule[]): Promise<void> => ipcRenderer.invoke(IpcChannel.RulesSet, rules),
    test: (req: RulesTestRequest): Promise<RulesTestResponse> =>
      ipcRenderer.invoke(IpcChannel.RulesTest, req),
  },
  license: {
    status: (): Promise<LicenseStatus> => ipcRenderer.invoke(IpcChannel.LicenseStatus),
    activate: (req: LicenseActivateRequest): Promise<LicenseStatus> =>
      ipcRenderer.invoke(IpcChannel.LicenseActivate, req),
    deactivate: (): Promise<void> => ipcRenderer.invoke(IpcChannel.LicenseDeactivate),
  },
  updater: {
    check: (): Promise<{ available: boolean; version?: string; url?: string }> =>
      ipcRenderer.invoke(IpcChannel.UpdaterCheck),
    download: (): Promise<void> => ipcRenderer.invoke(IpcChannel.UpdaterDownload),
    install: (): Promise<void> => ipcRenderer.invoke(IpcChannel.UpdaterInstall),
  },
  app: {
    onMenuAction: (cb: (action: MenuAction) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, action: MenuAction): void => cb(action);
      ipcRenderer.on(IpcChannel.AppMenuAction, listener);
      return () => ipcRenderer.removeListener(IpcChannel.AppMenuAction, listener);
    },
    getInitialCompare: (): Promise<InitialCompareSession | null> =>
      ipcRenderer.invoke(IpcChannel.AppGetInitialCompare),
    onCloseRequest: (cb: () => void): (() => void) => {
      const listener = (): void => cb();
      ipcRenderer.on(IpcChannel.AppRequestClose, listener);
      return () => ipcRenderer.removeListener(IpcChannel.AppRequestClose, listener);
    },
    closeWindow: (): void => {
      ipcRenderer.send(IpcChannel.AppCloseWindow);
    },
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.AppOpenExternal, url),
    getInfo: (): Promise<{
      name: string;
      version: string;
      electron: string;
      chrome: string;
      node: string;
      platform: string;
      arch: string;
    }> => ipcRenderer.invoke(IpcChannel.AppGetInfo),
  },
  dialog: {
    pickFolder: (req?: DialogPickFolderRequest): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannel.DialogPickFolder, req ?? {}),
    pickFile: (req?: DialogPickFileRequest): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannel.DialogPickFile, req ?? {}),
    confirmUnsaved: (
      req?: DialogConfirmUnsavedRequest,
    ): Promise<DialogConfirmUnsavedChoice> =>
      ipcRenderer.invoke(IpcChannel.DialogConfirmUnsaved, req ?? {}),
  },
};

contextBridge.exposeInMainWorld('awapi', api);
