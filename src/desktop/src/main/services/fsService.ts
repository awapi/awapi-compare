import {
  FS_ERROR_EXTERNAL_MODIFICATION,
  FS_ERROR_FILE_TOO_LARGE,
  MAX_TEXT_FILE_BYTES,
  diffOptionsFromMode,
  type ComparedPair,
  type DiffOptions,
  type FsCopyRequest,
  type FsCopyResult,
  type FsEntry,
  type FsReadChunkRequest,
  type FsReadRequest,
  type FsReadResult,
  type FsScanRequest,
  type FsScanResult,
  type FsStatRequest,
  type FsStatResult,
  type FsWriteRequest,
  type ScanProgress,
} from '@awapi/shared';

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { classifyPair } from './diffService.js';
import { HashService } from './hashService.js';
import { pairingKey } from './pairing.js';
import { compileRules, evaluate } from './ruleMatcher.js';
import type { ScannerOptions } from './scanner.js';
import { scan as scanTree } from './scanner.js';

export type ScanProgressListener = (progress: ScanProgress) => void;

/**
 * Narrow filesystem surface used by `read` / `stat` / `write` /
 * `readChunk`. Matches both `node:fs/promises` and memfs's
 * `fs.promises` so tests can inject an in-memory volume.
 */
export interface FsIo {
  readFile(path: string): Promise<Buffer | Uint8Array>;
  writeFile(
    path: string,
    data: Uint8Array | string,
    options?: { encoding?: BufferEncoding | null },
  ): Promise<void>;
  stat(path: string): Promise<{
    size: number;
    mtimeMs: number;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }>;
  open(path: string, flags: string): Promise<{
    read(
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number | null,
    ): Promise<{ bytesRead: number; buffer: Uint8Array }>;
    close(): Promise<void>;
  }>;
  /** Used by `fs.copy`. */
  readdir(path: string): Promise<string[]>;
  /** Used by `fs.copy` to recreate directory structure. */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  /** Used by `fs.copy`. */
  copyFile(from: string, to: string): Promise<void>;
  /** Used by `fs.copy` so symlinks aren't silently followed. */
  lstat(path: string): Promise<{
    size: number;
    mtimeMs: number;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }>;
}

/**
 * Sentinel error codes surfaced through IPC so the renderer can
 * distinguish recoverable cases (large file / external modification)
 * from generic failures. Re-exported from `@awapi/shared` to keep the
 * symbol importable from main-side modules.
 */
export {
  FS_ERROR_FILE_TOO_LARGE,
  FS_ERROR_EXTERNAL_MODIFICATION,
} from '@awapi/shared';

export class FsCodedError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'FsCodedError';
  }
}

export interface FsServiceDeps {
  /** Scanner options (injectable fs). Defaults to `node:fs`. */
  scannerOptions?: ScannerOptions;
  /** Hash service instance used in thorough/binary mode. */
  hash?: HashService;
  /**
   * I/O surface for read/stat/write/readChunk. Defaults to
   * `node:fs.promises`.
   */
  io?: FsIo;
}

/**
 * Filesystem operations and folder scanning. `scan` and `readChunk`
 * dispatch progress events to registered listeners. Copy/write land in
 * subsequent phases.
 */
export class FsService {
  private readonly progressListeners = new Set<ScanProgressListener>();

  constructor(private readonly deps: FsServiceDeps = {}) {}

  async scan(req: FsScanRequest): Promise<FsScanResult> {
    const started = Date.now();
    const compiledRules = compileRules(req.rules);
    const diffOptions: DiffOptions = req.diffOptions ?? diffOptionsFromMode(req.mode);
    const options: ScannerOptions = {
      ...this.deps.scannerOptions,
      followSymlinks: req.followSymlinks === true,
    };

    // Each side maps `pairingKey -> entry`. Two entries (one per side)
    // pair iff they yield the same key under the active pairing
    // options (case / extension / Unicode-normalisation).
    const leftMap = new Map<string, FsEntry>();
    const rightMap = new Map<string, FsEntry>();
    const errors: Array<{ side: 'left' | 'right'; relPath: string; message: string }> = [];

    let scanned = 0;
    const emitProgress = (currentPath?: string): void => {
      scanned += 1;
      this.emitScanProgress({ scanned, currentPath });
    };

    await Promise.all([
      collectSide(
        req.leftRoot,
        options,
        compiledRules,
        diffOptions,
        leftMap,
        (relPath, message) => {
          errors.push({ side: 'left', relPath, message });
        },
        emitProgress,
      ),
      collectSide(
        req.rightRoot,
        options,
        compiledRules,
        diffOptions,
        rightMap,
        (relPath, message) => {
          errors.push({ side: 'right', relPath, message });
        },
        emitProgress,
      ),
    ]);

    const keys = new Set<string>([...leftMap.keys(), ...rightMap.keys()]);
    const pairs: ComparedPair[] = [];

    for (const key of [...keys].sort()) {
      const left = leftMap.get(key);
      const right = rightMap.get(key);
      pairs.push(await this.classifyAndHash(left, right, req, diffOptions));
    }

    for (const e of errors) {
      pairs.push({ relPath: e.relPath, status: 'error', error: `${e.side}: ${e.message}` });
    }

    return { pairs, durationMs: Date.now() - started };
  }

  private async classifyAndHash(
    left: FsEntry | undefined,
    right: FsEntry | undefined,
    req: FsScanRequest,
    diffOptions: DiffOptions,
  ): Promise<ComparedPair> {
    // Pair `relPath` is the left's when present, otherwise the right's
    // — matches v0 behaviour and gives the renderer a stable display key.
    const relPath = left?.relPath ?? right?.relPath ?? '';
    let hashes: { left?: string; right?: string } | undefined;

    const wantsContent = diffOptions.content.mode !== 'off';
    const bothFiles =
      !!left && !!right && left.type === 'file' && right.type === 'file';
    const sizesMatch = bothFiles && left.size === right.size;
    // Skip the hash optimisation when attributes already match and the
    // user opted in to short-circuiting (default).
    const attributesAlreadyMatch =
      bothFiles &&
      sizesMatch &&
      diffOptions.content.skipWhenAttributesMatch &&
      // mtime check matches what classifier will compute.
      Math.abs(left.mtimeMs - right.mtimeMs) <=
        diffOptions.attributes.mtime.toleranceSeconds * 1000;

    if (bothFiles && wantsContent && sizesMatch && !attributesAlreadyMatch) {
      const hash = this.deps.hash ?? new HashService();
      const [l, r] = await Promise.all([
        safeHash(hash, joinAbs(req.leftRoot, left.relPath)),
        safeHash(hash, joinAbs(req.rightRoot, right.relPath)),
      ]);
      if (l.error || r.error) {
        return {
          relPath,
          left,
          right,
          status: 'error',
          error: l.error ?? r.error,
        };
      }
      hashes = { left: l.value, right: r.value };
    }

    const status = classifyPair(left, right, req.mode, hashes, { diffOptions });

    const pair: ComparedPair = { relPath, status };
    if (left) pair.left = left;
    if (right) pair.right = right;
    if (hashes?.left !== undefined) pair.leftHash = hashes.left;
    if (hashes?.right !== undefined) pair.rightHash = hashes.right;
    return pair;
  }

  readChunk(req: FsReadChunkRequest): Promise<Uint8Array> {
    return this.readChunkImpl(req);
  }

  copy(req: FsCopyRequest): Promise<FsCopyResult> {
    return this.copyImpl(req);
  }

  write(req: FsWriteRequest): Promise<void> {
    return this.writeImpl(req);
  }

  read(req: FsReadRequest): Promise<FsReadResult> {
    return this.readImpl(req);
  }

  stat(req: FsStatRequest): Promise<FsStatResult> {
    return this.statImpl(req);
  }

  private get io(): FsIo {
    return this.deps.io ?? (nodeFs.promises as unknown as FsIo);
  }

  private async readImpl(req: FsReadRequest): Promise<FsReadResult> {
    const cap = req.maxBytes ?? MAX_TEXT_FILE_BYTES;
    const stat = await this.io.stat(req.path);
    if (!stat.isFile()) {
      throw new FsCodedError(`fs.read: ${req.path} is not a file`, 'E_NOT_FILE');
    }
    if (stat.size > cap) {
      throw new FsCodedError(
        `fs.read: ${req.path} exceeds the ${cap}-byte cap`,
        FS_ERROR_FILE_TOO_LARGE,
        { size: stat.size, maxBytes: cap },
      );
    }
    const data = await this.io.readFile(req.path);
    const view = data instanceof Uint8Array ? data : new Uint8Array(data);
    // Return a fresh Uint8Array so we don't accidentally surface a
    // pooled Buffer back through IPC structured-clone.
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    return { data: copy, size: stat.size, mtimeMs: stat.mtimeMs };
  }

  private async statImpl(req: FsStatRequest): Promise<FsStatResult> {
    const stat = await this.io.stat(req.path);
    const type: FsStatResult['type'] = stat.isFile()
      ? 'file'
      : stat.isDirectory()
        ? 'dir'
        : stat.isSymbolicLink()
          ? 'symlink'
          : 'other';
    return { size: stat.size, mtimeMs: stat.mtimeMs, type };
  }

  private async writeImpl(req: FsWriteRequest): Promise<void> {
    if (req.expectedMtimeMs !== undefined) {
      // External-modification guard. Tolerate ±1ms because some
      // filesystems (FAT, older HFS) round mtimes.
      let actual: { mtimeMs: number } | null = null;
      try {
        actual = await this.io.stat(req.path);
      } catch {
        // File missing is a different kind of conflict, but for now
        // we treat it the same way — the renderer should re-check.
        actual = null;
      }
      if (actual && Math.abs(actual.mtimeMs - req.expectedMtimeMs) > 1) {
        throw new FsCodedError(
          `fs.write: ${req.path} was modified externally`,
          FS_ERROR_EXTERNAL_MODIFICATION,
          { expectedMtimeMs: req.expectedMtimeMs, actualMtimeMs: actual.mtimeMs },
        );
      }
    }
    const encoding = req.encoding ?? (typeof req.contents === 'string' ? 'utf8' : 'binary');
    if (encoding === 'utf8') {
      const text = typeof req.contents === 'string'
        ? req.contents
        : Buffer.from(req.contents).toString('utf8');
      await this.io.writeFile(req.path, text, { encoding: 'utf8' });
    } else {
      const bytes = typeof req.contents === 'string'
        ? new TextEncoder().encode(req.contents)
        : req.contents;
      await this.io.writeFile(req.path, bytes);
    }
  }

  private async copyImpl(req: FsCopyRequest): Promise<FsCopyResult> {
    const result: FsCopyResult = { copied: 0, skipped: 0, errors: [] };
    const overwrite = req.overwrite === true;
    const dryRun = req.dryRun === true;
    await this.copyRecursive(req.from, req.to, overwrite, dryRun, result);
    return result;
  }

  private async copyRecursive(
    from: string,
    to: string,
    overwrite: boolean,
    dryRun: boolean,
    result: FsCopyResult,
  ): Promise<void> {
    let stat: Awaited<ReturnType<FsIo['lstat']>>;
    try {
      stat = await this.io.lstat(from);
    } catch (err) {
      result.errors.push({ path: from, message: errMessage(err) });
      return;
    }
    if (stat.isSymbolicLink()) {
      // Conservative: never follow symlinks during copy. Skip and let
      // the caller surface the count if needed.
      result.skipped += 1;
      return;
    }
    if (stat.isDirectory()) {
      if (!dryRun) {
        try {
          await this.io.mkdir(to, { recursive: true });
        } catch (err) {
          result.errors.push({ path: to, message: errMessage(err) });
          return;
        }
      }
      let entries: string[];
      try {
        entries = await this.io.readdir(from);
      } catch (err) {
        result.errors.push({ path: from, message: errMessage(err) });
        return;
      }
      for (const name of entries) {
        await this.copyRecursive(
          nodePath.join(from, name),
          nodePath.join(to, name),
          overwrite,
          dryRun,
          result,
        );
      }
      return;
    }
    if (!stat.isFile()) {
      // Sockets / FIFOs / etc — skip silently.
      result.skipped += 1;
      return;
    }
    // File case.
    let exists = false;
    try {
      await this.io.stat(to);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists && !overwrite) {
      result.skipped += 1;
      return;
    }
    if (dryRun) {
      result.copied += 1;
      return;
    }
    try {
      await this.io.mkdir(nodePath.dirname(to), { recursive: true });
    } catch {
      // Tolerate — copyFile will report a clearer error if needed.
    }
    try {
      await this.io.copyFile(from, to);
      result.copied += 1;
    } catch (err) {
      result.errors.push({ path: from, message: errMessage(err) });
    }
  }

  private async readChunkImpl(req: FsReadChunkRequest): Promise<Uint8Array> {
    if (!Number.isInteger(req.offset) || req.offset < 0) {
      throw new Error(`fs.readChunk: offset must be a non-negative integer`);
    }
    if (!Number.isInteger(req.length) || req.length <= 0) {
      throw new Error(`fs.readChunk: length must be a positive integer`);
    }
    const handle = await this.io.open(req.path, 'r');
    try {
      const buf = new Uint8Array(req.length);
      const { bytesRead } = await handle.read(buf, 0, req.length, req.offset);
      return bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  onScanProgress(listener: ScanProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  /** Emit a progress event to all subscribers. */
  emitScanProgress(progress: ScanProgress): void {
    for (const l of this.progressListeners) l(progress);
  }
}

async function collectSide(
  root: string,
  options: ScannerOptions,
  compiledRules: ReturnType<typeof compileRules>,
  diffOptions: DiffOptions,
  into: Map<string, FsEntry>,
  onError: (relPath: string, message: string) => void,
  onProgress: (currentPath?: string) => void,
): Promise<void> {
  for await (const item of scanTree(root, options)) {
    if (item.kind === 'error') {
      onError(item.relPath, item.message);
      continue;
    }
    if (evaluate(compiledRules, item.entry) === 'excluded') continue;
    const key = pairingKey(item.entry.relPath, diffOptions.pairing);
    into.set(key, item.entry);
    onProgress(item.entry.relPath);
  }
}

async function safeHash(
  hash: HashService,
  path: string,
): Promise<{ value?: string; error?: string }> {
  try {
    return { value: await hash.hash(path) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function joinAbs(root: string, rel: string): string {
  if (root.endsWith('/') || root.endsWith('\\')) return root + rel;
  return `${root}/${rel}`;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
