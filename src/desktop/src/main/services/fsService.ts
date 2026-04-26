import {
  diffOptionsFromMode,
  type ComparedPair,
  type DiffOptions,
  type FsCopyRequest,
  type FsCopyResult,
  type FsEntry,
  type FsReadChunkRequest,
  type FsScanRequest,
  type FsScanResult,
  type FsWriteRequest,
  type ScanProgress,
} from '@awapi/shared';

import { classifyPair } from './diffService.js';
import { NotImplementedError } from './errors.js';
import { HashService } from './hashService.js';
import { pairingKey } from './pairing.js';
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
