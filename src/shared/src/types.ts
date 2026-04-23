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

export interface Rule {
  id: string;
  kind: RuleKind;
  /** Glob pattern (picomatch syntax). */
  pattern: string;
  /** Optional size filter in bytes, e.g. { gt: 1024 }. */
  size?: { gt?: number; lt?: number };
  /** Optional mtime filter, epoch ms. */
  mtime?: { after?: number; before?: number };
  enabled: boolean;
}

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
