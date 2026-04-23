import type { ComparedPair, CompareMode, DiffStatus, FsEntry } from '@awapi/shared';

/**
 * Tolerance (in ms) used when comparing modification times. Two mtimes
 * within this window are treated as equal. Filesystems differ in mtime
 * precision (FAT: 2 s; APFS: 1 ns), so we default to 2 s.
 */
export const MTIME_EPSILON_MS = 2000;

export interface ClassifyOptions {
  /** mtime tolerance in ms. Defaults to `MTIME_EPSILON_MS`. */
  mtimeEpsilonMs?: number;
}

/**
 * Pure pair classifier. Given left/right metadata (and optional content
 * hashes for thorough/binary modes) returns the applicable `DiffStatus`.
 * `undefined` on either side means the entry is missing there.
 *
 * Deliberately side-effect-free and `electron`-free: unit-testable in
 * isolation with 100% branch coverage.
 */
export function classifyPair(
  left: FsEntry | undefined,
  right: FsEntry | undefined,
  mode: CompareMode,
  hashes?: { left?: string; right?: string },
  opts: ClassifyOptions = {},
): DiffStatus {
  if (!left && !right) {
    throw new Error('classifyPair: both sides undefined');
  }
  if (left && !right) return 'left-only';
  if (!left && right) return 'right-only';

  const l = left as FsEntry;
  const r = right as FsEntry;
  const eps = opts.mtimeEpsilonMs ?? MTIME_EPSILON_MS;

  // Type mismatch (e.g. file vs dir) — always different.
  if (l.type !== r.type) return 'different';
  // Two directories: treat as identical; children are classified individually.
  if (l.type === 'dir') return 'identical';

  if (l.size !== r.size) {
    return classifyByMtime(l.mtimeMs, r.mtimeMs, eps, 'different');
  }

  if (mode === 'quick') {
    return classifyByMtime(l.mtimeMs, r.mtimeMs, eps, 'identical');
  }

  // thorough / binary: must have content hashes.
  const lh = hashes?.left;
  const rh = hashes?.right;
  if (lh === undefined || rh === undefined) {
    throw new Error('classifyPair: hashes required for thorough/binary mode');
  }
  if (lh === rh) return 'identical';
  return classifyByMtime(l.mtimeMs, r.mtimeMs, eps, 'different');
}

function classifyByMtime(
  lMs: number,
  rMs: number,
  epsilon: number,
  tieStatus: DiffStatus,
): DiffStatus {
  const delta = lMs - rMs;
  if (Math.abs(delta) <= epsilon) return tieStatus;
  return delta > 0 ? 'newer-left' : 'newer-right';
}

/**
 * Stateless service wrapper around `classifyPair`. Kept as a class so the
 * main-process wiring stays consistent with the other services.
 */
export class DiffService {
  classify(
    left: FsEntry | undefined,
    right: FsEntry | undefined,
    mode: CompareMode,
    hashes?: { left?: string; right?: string },
  ): ComparedPair {
    const relPath = left?.relPath ?? right?.relPath ?? '';
    const status = classifyPair(left, right, mode, hashes);
    const pair: ComparedPair = { relPath, status };
    if (left) pair.left = left;
    if (right) pair.right = right;
    if (hashes?.left !== undefined) pair.leftHash = hashes.left;
    if (hashes?.right !== undefined) pair.rightHash = hashes.right;
    return pair;
  }
}
