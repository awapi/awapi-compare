import {
  DEFAULT_DIFF_OPTIONS,
  diffOptionsFromMode,
  mergeDiffOptions,
  mtimeDeltaWithinTolerance,
  type ComparedPair,
  type CompareMode,
  type DiffOptions,
  type DiffStatus,
  type FsEntry,
} from '@awapi/shared';

/**
 * Default mtime equality window in milliseconds. Mirrors
 * `DEFAULT_DIFF_OPTIONS.attributes.mtime.toleranceSeconds * 1000`.
 * Kept as a named export for tests and callers that pre-date
 * {@link DiffOptions}.
 */
export const MTIME_EPSILON_MS =
  DEFAULT_DIFF_OPTIONS.attributes.mtime.toleranceSeconds * 1000;

export interface ClassifyOptions {
  /**
   * Legacy override for mtime tolerance, in ms. Kept for back-compat;
   * new code paths should set `diffOptions` instead.
   */
  mtimeEpsilonMs?: number;
  /**
   * Full match policy. When omitted, defaults are derived from `mode`.
   */
  diffOptions?: DiffOptions;
}

/**
 * Pure pair classifier. Given left/right metadata (and optional content
 * hashes for content-comparison modes) returns the applicable
 * {@link DiffStatus}. Side-effect-free and `electron`-free.
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
  const options = resolveOptions(mode, opts);

  if (l.type !== r.type) return 'different';
  if (l.type === 'dir') return 'identical';

  const sizeEqual = !options.attributes.size || l.size === r.size;
  const mtimeEqual = mtimeDeltaWithinTolerance(
    l.mtimeMs,
    r.mtimeMs,
    options.attributes.mtime,
  );
  const attributesIdentical = sizeEqual && mtimeEqual;
  const tieStatus = mtimeTieStatus(l, r, options);

  // Pure-attribute mode: never read content.
  if (options.content.mode === 'off') {
    return attributesIdentical ? 'identical' : tieStatus;
  }

  // Symlinks (and any other non-file, non-dir entries) cannot be hashed,
  // so fall back to attribute-only comparison regardless of content mode.
  if (l.type !== 'file') {
    return attributesIdentical ? 'identical' : tieStatus;
  }

  // Content-comparison mode (checksum / binary / rules):
  // 1. Skip optimisation — when attributes already say equal.
  if (attributesIdentical && options.content.skipWhenAttributesMatch) {
    return 'identical';
  }
  // 2. Size mismatch is conclusive without reading content.
  if (!sizeEqual) {
    return tieStatus;
  }

  // 3. Sizes match → need hashes to decide content equality.
  const lh = hashes?.left;
  const rh = hashes?.right;
  if (lh === undefined || rh === undefined) {
    throw new Error('classifyPair: hashes required for thorough/binary mode');
  }
  if (lh === rh) return 'identical';

  // Content differs.
  if (!options.content.overrideAttributesResult && attributesIdentical) {
    return 'identical';
  }
  return tieStatus;
}

function mtimeTieStatus(l: FsEntry, r: FsEntry, options: DiffOptions): DiffStatus {
  if (!options.attributes.mtime.enabled) return 'different';
  if (mtimeDeltaWithinTolerance(l.mtimeMs, r.mtimeMs, options.attributes.mtime)) {
    return 'different';
  }
  return l.mtimeMs > r.mtimeMs ? 'newer-left' : 'newer-right';
}

function resolveOptions(mode: CompareMode, opts: ClassifyOptions): DiffOptions {
  if (opts.diffOptions) return opts.diffOptions;
  const base = diffOptionsFromMode(mode);
  if (opts.mtimeEpsilonMs !== undefined) {
    return mergeDiffOptions({
      ...base,
      attributes: {
        ...base.attributes,
        mtime: {
          ...base.attributes.mtime,
          toleranceSeconds: opts.mtimeEpsilonMs / 1000,
        },
      },
    });
  }
  return base;
}

/**
 * Stateless service wrapper around `classifyPair`.
 */
export class DiffService {
  classify(
    left: FsEntry | undefined,
    right: FsEntry | undefined,
    mode: CompareMode,
    hashes?: { left?: string; right?: string },
    options?: ClassifyOptions,
  ): ComparedPair {
    const relPath = left?.relPath ?? right?.relPath ?? '';
    const status = classifyPair(left, right, mode, hashes, options);
    const pair: ComparedPair = { relPath, status };
    if (left) pair.left = left;
    if (right) pair.right = right;
    if (hashes?.left !== undefined) pair.leftHash = hashes.left;
    if (hashes?.right !== undefined) pair.rightHash = hashes.right;
    return pair;
  }
}
