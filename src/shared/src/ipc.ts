import type {
  ComparedPair,
  CompareMode,
  DiffOptions,
  EntryType,
  LicenseStatus,
  Rule,
  RuleVerdict,
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
  FsRead: 'fs.read',
  FsReadChunk: 'fs.readChunk',
  FsHash: 'fs.hash',
  FsStat: 'fs.stat',
  FsCopy: 'fs.copy',
  FsWrite: 'fs.write',
  SessionSave: 'session.save',
  SessionLoad: 'session.load',
  SessionList: 'session.list',
  RulesGet: 'rules.get',
  RulesSet: 'rules.set',
  RulesTest: 'rules.test',
  LicenseStatus: 'license.status',
  LicenseActivate: 'license.activate',
  LicenseDeactivate: 'license.deactivate',
  UpdaterCheck: 'updater.check',
  UpdaterDownload: 'updater.download',
  UpdaterInstall: 'updater.install',
  SftpConnect: 'sftp.connect',
  AppMenuAction: 'app.menuAction',
  AppGetInitialCompare: 'app.getInitialCompare',
  DialogPickFolder: 'dialog.pickFolder',
  DialogPickFile: 'dialog.pickFile',
} as const;

export type IpcChannelId = (typeof IpcChannel)[keyof typeof IpcChannel];

// ---- Request / response payloads ---------------------------------------

export interface FsScanRequest {
  leftRoot: string;
  rightRoot: string;
  mode: CompareMode;
  rules: Rule[];
  followSymlinks?: boolean;
  /**
   * Per-session match policy. When omitted, the main process derives
   * defaults from {@link CompareMode} via `diffOptionsFromMode(mode)`.
   */
  diffOptions?: DiffOptions;
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

/**
 * Read an entire file (subject to {@link FsReadRequest.maxBytes}). The
 * response includes the contents plus an mtime stamp the renderer can
 * later pass back via {@link FsWriteRequest.expectedMtimeMs} to detect
 * external modifications during save.
 */
export interface FsReadRequest {
  path: string;
  /**
   * Hard cap on the number of bytes to return. Reads larger than this
   * reject with `E_FILE_TOO_LARGE`. Defaults to
   * `MAX_TEXT_FILE_BYTES` from `fileKind`.
   */
  maxBytes?: number;
}

export interface FsReadResult {
  data: Uint8Array;
  size: number;
  mtimeMs: number;
}

/**
 * Read filesystem metadata for a single path. Used by the file-diff
 * tab to detect external modifications between load and save.
 */
export interface FsStatRequest {
  path: string;
}

export interface FsStatResult {
  size: number;
  mtimeMs: number;
  type: 'file' | 'dir' | 'symlink' | 'other';
}

export interface FsWriteRequest {
  path: string;
  contents: string | Uint8Array;
  encoding?: 'utf8' | 'binary';
  /**
   * If set, the main process re-stats the target before writing and
   * rejects with `E_EXTERNAL_MODIFICATION` when the file's mtime
   * differs (within a 1ms tolerance). Used by inline edit + save to
   * surface a confirm prompt to the user.
   */
  expectedMtimeMs?: number;
}

/**
 * Error code returned via the IPC error channel when an `fs.write`
 * with `expectedMtimeMs` detects that the file changed on disk
 * between the read and the write. Renderers compare against this
 * constant rather than embedding the literal.
 */
export const FS_ERROR_EXTERNAL_MODIFICATION = 'E_EXTERNAL_MODIFICATION';

/** Error code returned when a file exceeds the read-size cap. */
export const FS_ERROR_FILE_TOO_LARGE = 'E_FILE_TOO_LARGE';

export interface LicenseActivateRequest {
  key: string;
}

/**
 * Request payload for {@link AwapiApi.dialog.pickFolder}. Both fields are
 * optional; the main process resolves a sensible default if omitted.
 */
export interface DialogPickFolderRequest {
  /** Pre-populate the dialog at this directory if it exists. */
  defaultPath?: string;
  /** Optional dialog title (some platforms ignore this). */
  title?: string;
}

export interface DialogPickFolderResult {
  /** Absolute path to the selected folder, or `null` if cancelled. */
  path: string | null;
}

/**
 * Request payload for {@link AwapiApi.dialog.pickFile}. Both fields are
 * optional; the main process resolves a sensible default if omitted.
 */
export interface DialogPickFileRequest {
  /**
   * Pre-populate the dialog at this path. If it points to a file, the
   * picker opens its containing directory; if it points to a folder,
   * that folder is used; non-existent paths walk up to the nearest
   * existing ancestor.
   */
  defaultPath?: string;
  /** Optional dialog title (some platforms ignore this). */
  title?: string;
}

export interface DialogPickFileResult {
  /** Absolute path to the selected file, or `null` if cancelled. */
  path: string | null;
}

/**
 * Initial compare session injected at app launch from CLI args or env
 * vars (e.g. `awapi-compare --type folder --left ./a --right ./b`).
 * The renderer fetches this once on startup and pre-populates the
 * first compare tab. `null` means "no CLI session — open empty".
 */
export interface InitialCompareSession {
  type: 'folder';
  /** Absolute path. */
  leftRoot: string;
  /** Absolute path. */
  rightRoot: string;
  mode: CompareMode;
}

/**
 * A minimal entry-shaped sample used by the rules editor's live preview.
 * Mirrors the fields {@link Rule} predicates inspect.
 */
export interface RuleTestSample {
  /** Posix-style relative path used by `target: 'path'` patterns. */
  relPath: string;
  /** Basename used by `target: 'name'` patterns. Defaults to last `/` segment. */
  name?: string;
  /**
   * Entry kind, used by rule `scope` matching. Defaults to `'file'`
   * when omitted (preserves the v0 preview behaviour).
   */
  type?: EntryType;
  /** Size in bytes; required for `size` predicates. */
  size?: number;
  /** Modification time (epoch ms); required for `mtime` predicates. */
  mtimeMs?: number;
}

export interface RulesTestRequest {
  rules: Rule[];
  samples: RuleTestSample[];
}

export interface RulesTestResponse {
  /** One verdict per input sample, in the same order. */
  verdicts: RuleVerdict[];
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
    read(req: FsReadRequest): Promise<FsReadResult>;
    readChunk(req: FsReadChunkRequest): Promise<Uint8Array>;
    hash(path: string): Promise<string>;
    stat(req: FsStatRequest): Promise<FsStatResult>;
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
    test(req: RulesTestRequest): Promise<RulesTestResponse>;
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
    /**
     * Read the initial compare session passed to the app via CLI args
     * or env vars. Resolves to `null` when the app was launched with
     * no folder pair.
     */
    getInitialCompare(): Promise<InitialCompareSession | null>;
  };
  dialog: {
    /**
     * Show a native folder-picker dialog. Resolves with the selected
     * absolute path, or `null` if the user cancelled.
     */
    pickFolder(req?: DialogPickFolderRequest): Promise<string | null>;
    /**
     * Show a native file-picker dialog. Resolves with the selected
     * absolute path, or `null` if the user cancelled.
     */
    pickFile(req?: DialogPickFileRequest): Promise<string | null>;
  };
}

declare global {
  interface Window {
    awapi: AwapiApi;
  }
}
