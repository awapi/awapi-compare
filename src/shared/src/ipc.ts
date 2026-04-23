import type {
  ComparedPair,
  CompareMode,
  LicenseStatus,
  Rule,
  ScanProgress,
  Session,
} from './types.js';

/**
 * IPC channel identifiers. All main<->renderer communication goes through
 * these string-typed channels. Add a new entry here FIRST, then implement
 * handler in main and expose via preload.
 */
export const IpcChannel = {
  FsScan: 'fs.scan',
  FsScanProgress: 'fs.scan.progress',
  FsReadChunk: 'fs.readChunk',
  FsHash: 'fs.hash',
  FsCopy: 'fs.copy',
  FsWrite: 'fs.write',
  SessionSave: 'session.save',
  SessionLoad: 'session.load',
  SessionList: 'session.list',
  RulesGet: 'rules.get',
  RulesSet: 'rules.set',
  LicenseStatus: 'license.status',
  LicenseActivate: 'license.activate',
  LicenseDeactivate: 'license.deactivate',
  UpdaterCheck: 'updater.check',
  UpdaterDownload: 'updater.download',
  UpdaterInstall: 'updater.install',
  SftpConnect: 'sftp.connect',
  AppMenuAction: 'app.menuAction',
} as const;

export type IpcChannelId = (typeof IpcChannel)[keyof typeof IpcChannel];

// ---- Request / response payloads ---------------------------------------

export interface FsScanRequest {
  leftRoot: string;
  rightRoot: string;
  mode: CompareMode;
  rules: Rule[];
  followSymlinks?: boolean;
}

export interface FsScanResult {
  pairs: ComparedPair[];
  durationMs: number;
}

export interface FsCopyRequest {
  from: string;
  to: string;
  overwrite?: boolean;
  dryRun?: boolean;
}

export interface FsCopyResult {
  copied: number;
  skipped: number;
  errors: Array<{ path: string; message: string }>;
}

export interface FsReadChunkRequest {
  path: string;
  offset: number;
  length: number;
}

export interface FsWriteRequest {
  path: string;
  contents: string | Uint8Array;
  encoding?: 'utf8' | 'binary';
}

export interface LicenseActivateRequest {
  key: string;
}

/**
 * Semantic identifiers for commands emitted by the native application
 * menu (File / Edit / View / Help). The renderer subscribes via
 * `awapi.app.onMenuAction` and dispatches UI behaviour accordingly.
 * New actions MUST be added here first, then wired in `menuService`.
 */
export type MenuAction =
  // File
  | 'session.new'
  | 'session.open'
  | 'session.save'
  | 'session.saveAs'
  | 'session.refresh'
  | 'session.closeTab'
  // Edit
  | 'edit.find'
  | 'edit.findNext'
  | 'edit.findPrev'
  | 'edit.preferences'
  // Compare (Edit submenu)
  | 'compare.copyLeftToRight'
  | 'compare.copyRightToLeft'
  | 'compare.markSame'
  | 'compare.exclude'
  // View
  | 'view.toggleTheme'
  | 'view.expandAll'
  | 'view.collapseAll'
  // Help
  | 'help.docs'
  | 'help.checkForUpdates'
  | 'help.viewLicense'
  | 'help.about';

/**
 * Typed API surface exposed to the renderer via preload's `contextBridge`.
 * The renderer accesses this as `window.awapi`.
 */
export interface AwapiApi {
  fs: {
    scan(req: FsScanRequest): Promise<FsScanResult>;
    readChunk(req: FsReadChunkRequest): Promise<Uint8Array>;
    hash(path: string): Promise<string>;
    copy(req: FsCopyRequest): Promise<FsCopyResult>;
    write(req: FsWriteRequest): Promise<void>;
    onScanProgress(cb: (p: ScanProgress) => void): () => void;
  };
  session: {
    save(session: Session): Promise<void>;
    load(id: string): Promise<Session | null>;
    list(): Promise<Session[]>;
  };
  rules: {
    get(): Promise<Rule[]>;
    set(rules: Rule[]): Promise<void>;
  };
  license: {
    status(): Promise<LicenseStatus>;
    activate(req: LicenseActivateRequest): Promise<LicenseStatus>;
    deactivate(): Promise<void>;
  };
  updater: {
    check(): Promise<{ available: boolean; version?: string }>;
    download(): Promise<void>;
    install(): Promise<void>;
  };
  app: {
    /**
     * Subscribe to application-menu actions dispatched by the main
     * process. Returns an unsubscribe function.
     */
    onMenuAction(cb: (action: MenuAction) => void): () => void;
  };
}

declare global {
  interface Window {
    awapi: AwapiApi;
  }
}
