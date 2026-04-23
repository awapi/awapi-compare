import type {
  ComparedPair,
  FsCopyRequest,
  FsCopyResult,
  FsEntry,
  FsReadChunkRequest,
  FsScanRequest,
  FsScanResult,
  FsWriteRequest,
  ScanProgress,
} from '@awapi/shared';

import { classifyPair } from './diffService.js';
import { NotImplementedError } from './errors.js';
import { HashService } from './hashService.js';
import { compileRules, evaluate } from './ruleMatcher.js';
import type { ScannerOptions } from './scanner.js';
import { scan as scanTree } from './scanner.js';

export type ScanProgressListener = (progress: ScanProgress) => void;

export interface FsServiceDeps {
  /** Scanner options (injectable fs). Defaults to `node:fs`. */
  scannerOptions?: ScannerOptions;
  /** Hash service instance used in thorough/binary mode. */
  hash?: HashService;
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
    const options: ScannerOptions = {
      ...this.deps.scannerOptions,
      followSymlinks: req.followSymlinks === true,
    };

    const leftMap = new Map<string, FsEntry>();
    const rightMap = new Map<string, FsEntry>();
    const errors: Array<{ side: 'left' | 'right'; relPath: string; message: string }> = [];

    let scanned = 0;
    const emitProgress = (currentPath?: string): void => {
      scanned += 1;
      this.emitScanProgress({ scanned, currentPath });
    };

    await Promise.all([
      collectSide(req.leftRoot, options, compiledRules, leftMap, (relPath, message) => {
        errors.push({ side: 'left', relPath, message });
      }, emitProgress),
      collectSide(req.rightRoot, options, compiledRules, rightMap, (relPath, message) => {
        errors.push({ side: 'right', relPath, message });
      }, emitProgress),
    ]);

    const relPaths = new Set<string>([...leftMap.keys(), ...rightMap.keys()]);
    const pairs: ComparedPair[] = [];

    for (const relPath of [...relPaths].sort()) {
      const left = leftMap.get(relPath);
      const right = rightMap.get(relPath);
      pairs.push(await this.classifyAndHash(relPath, left, right, req));
    }

    for (const e of errors) {
      pairs.push({ relPath: e.relPath, status: 'error', error: `${e.side}: ${e.message}` });
    }

    return { pairs, durationMs: Date.now() - started };
  }

  private async classifyAndHash(
    relPath: string,
    left: FsEntry | undefined,
    right: FsEntry | undefined,
    req: FsScanRequest,
  ): Promise<ComparedPair> {
    let hashes: { left?: string; right?: string } | undefined;

    const needsHashes =
      !!left &&
      !!right &&
      left.type === 'file' &&
      right.type === 'file' &&
      (req.mode === 'thorough' || req.mode === 'binary');

    if (left && right && needsHashes && left.size === right.size) {
      const hash = this.deps.hash ?? new HashService();
      const [l, r] = await Promise.all([
        safeHash(hash, joinAbs(req.leftRoot, relPath)),
        safeHash(hash, joinAbs(req.rightRoot, relPath)),
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

    // Size mismatch in thorough/binary: fall back to quick-mode classifier
    // (size alone proves inequality; mtime breaks the tie).
    const effectiveMode = needsHashes && !hashes ? 'quick' : req.mode;
    const status = classifyPair(left, right, effectiveMode, hashes);

    const pair: ComparedPair = { relPath, status };
    if (left) pair.left = left;
    if (right) pair.right = right;
    if (hashes?.left !== undefined) pair.leftHash = hashes.left;
    if (hashes?.right !== undefined) pair.rightHash = hashes.right;
    return pair;
  }

  readChunk(_req: FsReadChunkRequest): Promise<Uint8Array> {
    throw new NotImplementedError('fs.readChunk', 'Phase 7');
  }

  copy(_req: FsCopyRequest): Promise<FsCopyResult> {
    throw new NotImplementedError('fs.copy', 'Phase 5');
  }

  write(_req: FsWriteRequest): Promise<void> {
    throw new NotImplementedError('fs.write', 'Phase 7');
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
    into.set(item.entry.relPath, item.entry);
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
