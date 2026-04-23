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
}

declare global {
  interface Window {
    awapi: AwapiApi;
  }
}
