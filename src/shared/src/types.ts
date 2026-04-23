/**
 * Core domain types shared between main and renderer.
 */

export type CompareMode = 'quick' | 'thorough' | 'binary';

export type EntryType = 'file' | 'dir' | 'symlink';

export type DiffStatus =
  | 'left-only'
  | 'right-only'
  | 'identical'
  | 'different'
  | 'newer-left'
  | 'newer-right'
  | 'excluded'
  | 'error';

export interface FsEntry {
  /** Path relative to the session root on its side. */
  relPath: string;
  name: string;
  type: EntryType;
  /** Size in bytes (files only). */
  size: number;
  /** Modification time, epoch ms. */
  mtimeMs: number;
  /** POSIX permission bits (best-effort on Windows). */
  mode: number;
}

export interface ComparedPair {
  relPath: string;
  left?: FsEntry;
  right?: FsEntry;
  status: DiffStatus;
  /** Populated in thorough/binary mode. */
  leftHash?: string;
  rightHash?: string;
  error?: string;
}

export type RuleKind = 'include' | 'exclude';

/**
 * What the glob pattern is matched against:
 * - `'name'` — the entry's basename (e.g. `*.log` matches any file named `*.log`).
 * - `'path'` — the entry's relative path with `/` separators (e.g. `build/**`).
 *
 * Defaults to `'path'` when omitted, which preserves the v0 behaviour.
 */
export type RuleTarget = 'name' | 'path';

export interface Rule {
  id: string;
  kind: RuleKind;
  /** Glob pattern (picomatch syntax). */
  pattern: string;
  /** What the pattern matches against. Defaults to `'path'`. */
  target?: RuleTarget;
  /** Optional size filter in bytes, e.g. { gt: 1024 }. */
  size?: { gt?: number; lt?: number };
  /** Optional mtime filter, epoch ms. */
  mtime?: { after?: number; before?: number };
  enabled: boolean;
}

/**
 * Verdict for a single entry tested against a rule set. `'kept'` means
 * the entry passes through the filter; `'excluded'` means it is dropped.
 */
export type RuleVerdict = 'kept' | 'excluded';

export interface Session {
  id: string;
  name?: string;
  leftRoot: string;
  rightRoot: string;
  mode: CompareMode;
  rules: Rule[];
  createdAt: number;
  updatedAt: number;
}

export interface ScanProgress {
  scanned: number;
  total?: number;
  currentPath?: string;
}

export interface LicenseStatus {
  state: 'trial' | 'active' | 'expired' | 'invalid' | 'revoked';
  trialDaysRemaining?: number;
  expiresAt?: number;
  licensee?: string;
}
