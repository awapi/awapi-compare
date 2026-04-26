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

/**
 * Which kinds of entries a rule applies to.
 *
 * - `'file'`   — rule only matches file entries (`type === 'file'`).
 * - `'folder'` — rule only matches directory entries (`type === 'dir'`
 *                or a directory-pointing symlink).
 * - `'any'`    — rule matches any entry. This is the default and
 *                preserves the v0 behaviour.
 *
 * Whitelist mode is evaluated **per scope**: an entry only flips into
 * "default-excluded" when the rule set contains an enabled `include`
 * rule whose `scope` applies to that entry. So a Simple-view rule set
 * that filters files (e.g. `include files: *.ts`) does not
 * accidentally drop every folder.
 */
export type RuleScope = 'file' | 'folder' | 'any';

export interface Rule {
  id: string;
  kind: RuleKind;
  /** Glob pattern (picomatch syntax). */
  pattern: string;
  /** What the pattern matches against. Defaults to `'path'`. */
  target?: RuleTarget;
  /** Which entry kinds the rule applies to. Defaults to `'any'`. */
  scope?: RuleScope;
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

/**
 * How file content equality is determined when attribute checks are
 * inconclusive (or when the user wants to override them).
 *
 * - `'off'`     — never read content; rely solely on attributes.
 * - `'checksum'` — streamed cryptographic hash (SHA-256 today).
 * - `'binary'`  — byte-by-byte comparison.
 * - `'rules'`   — rule-driven hybrid (defaults to checksum unless a
 *                  per-extension rule says otherwise; reserved for
 *                  future per-rule content strategies).
 */
export type ContentCompareMode = 'off' | 'checksum' | 'binary' | 'rules';

/**
 * Per-session match policy. Controls (a) how entries on the two sides
 * are paired up, (b) which attributes count as "the same", and (c) how
 * file content is compared. Lives on the {@link Session} and is passed
 * through {@link IpcChannel.FsScan} on every scan.
 *
 * Original API surface — does not mirror any third-party tool's naming.
 */
export interface DiffOptions {
  attributes: {
    /** When true, two files with different byte sizes are not equal. */
    size: boolean;
    mtime: {
      /** When false, mtime is ignored entirely (size-only equality). */
      enabled: boolean;
      /** Equality window for mtimes, in seconds. Defaults to 2. */
      toleranceSeconds: number;
      /**
       * When true, an mtime delta of (3600 ± tolerance) seconds is also
       * treated as equal — useful when one side observed a DST shift.
       */
      ignoreDstShift: boolean;
      /**
       * When true, the mtime delta is reduced modulo 1 hour before
       * comparing tolerance. Useful when the two sides live in
       * different timezones but record local wall-clock time.
       */
      ignoreTimezone: boolean;
    };
  };
  pairing: {
    /**
     * When false, filenames are paired case-insensitively (`Foo.txt`
     * on one side pairs with `foo.txt` on the other).
     */
    caseSensitive: boolean;
    /**
     * When true, files are paired by basename without their extension
     * (`foo.ts` ↔ `foo.js`).
     */
    ignoreExtension: boolean;
    /**
     * When true, filenames are normalised to NFC before pairing so
     * macOS-decomposed filenames pair with NFC equivalents.
     */
    unicodeNormalize: boolean;
  };
  content: {
    mode: ContentCompareMode;
    /**
     * When true, content comparison is skipped if the attribute checks
     * already concluded the files are equal.
     */
    skipWhenAttributesMatch: boolean;
    /**
     * When true, the content-comparison verdict overrides the
     * attribute verdict (e.g. files with different mtimes but identical
     * content are reported as identical).
     */
    overrideAttributesResult: boolean;
  };
}

export interface Session {
  id: string;
  name?: string;
  leftRoot: string;
  rightRoot: string;
  mode: CompareMode;
  rules: Rule[];
  /** Per-session match policy. Optional for back-compat. */
  diffOptions?: DiffOptions;
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
