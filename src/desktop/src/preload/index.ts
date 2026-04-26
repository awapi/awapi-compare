import { contextBridge, ipcRenderer } from 'electron';
import type {
  AwapiApi,
  DialogPickFolderRequest,
  FsCopyRequest,
  FsCopyResult,
  FsReadChunkRequest,
  FsScanRequest,
  FsScanResult,
  FsWriteRequest,
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
    readChunk: (req: FsReadChunkRequest): Promise<Uint8Array> =>
      ipcRenderer.invoke(IpcChannel.FsReadChunk, req),
    hash: (path: string): Promise<string> => ipcRenderer.invoke(IpcChannel.FsHash, path),
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
    check: (): Promise<{ available: boolean; version?: string }> =>
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
  },
  dialog: {
    pickFolder: (req?: DialogPickFolderRequest): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannel.DialogPickFolder, req ?? {}),
  },
};

contextBridge.exposeInMainWorld('awapi', api);
