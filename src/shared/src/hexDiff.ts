/**
 * Block-LCS hex diff algorithm.
 *
 * Compares two byte buffers by carving them into fixed-size blocks
 * (default 16 bytes — one hex-view row) and running the textbook
 * Longest-Common-Subsequence dynamic-programming algorithm over the
 * blocks' SHA-1-of-bytes signature. The output is a flat list of
 * {@link HexDiffSegment}s suitable for driving a synchronised
 * side-by-side hex viewer.
 *
 * Pure & deterministic — no Node APIs, no `electron`. Lives in
 * `@awapi/shared` so both renderer and tests can import it.
 *
 * Complexity is O(L*R) blocks in time/space — fine for the warn-then-
 * paginate strategy used by the hex view (block-LCS is bounded by
 * `MAX_HEX_DIFF_BLOCKS` per call).
 */

/** Default hex-view row width, in bytes. */
export const HEX_DIFF_BLOCK_SIZE = 16;

/**
 * Hard cap on (leftBlocks + rightBlocks). Above this the algorithm
 * refuses to run — callers are expected to fall back to a simple
 * "byte-equal-or-not" report. Roughly 4 MiB of data per side at the
 * default 16-byte block size.
 */
export const MAX_HEX_DIFF_BLOCKS = 524_288;

/**
 * One run of paired hex-view rows. Either both sides are present and
 * equal, or one or both sides have rows that diverge from the other.
 */
export type HexDiffSegment =
  | {
      kind: 'equal';
      /** Inclusive byte offset of the first row on the left side. */
      leftOffset: number;
      /** Inclusive byte offset of the first row on the right side. */
      rightOffset: number;
      /** Number of 16-byte rows in the run (>= 1). */
      rows: number;
    }
  | {
      kind: 'change';
      /** Number of left-side rows in the run (may be 0 for inserts). */
      leftRows: number;
      /** Number of right-side rows in the run (may be 0 for deletes). */
      rightRows: number;
      /** Inclusive byte offset on the left, or `undefined` if leftRows === 0. */
      leftOffset?: number;
      /** Inclusive byte offset on the right, or `undefined` if rightRows === 0. */
      rightOffset?: number;
    };

export interface HexDiffOptions {
  /** Bytes per row. Defaults to {@link HEX_DIFF_BLOCK_SIZE}. */
  blockSize?: number;
}

export interface HexDiffResult {
  segments: HexDiffSegment[];
  /** Number of rows on the left (`ceil(left.length / blockSize)`). */
  leftRows: number;
  /** Number of rows on the right (`ceil(right.length / blockSize)`). */
  rightRows: number;
  /** True when the buffers are byte-identical. */
  identical: boolean;
  /**
   * Set when the input was too large to LCS. The `segments` array is
   * still produced but degenerates to one big `change` (or `equal`
   * when the buffers happen to be byte-equal).
   */
  truncated: boolean;
}

/**
 * Compute a block-level diff between two byte buffers.
 *
 * The algorithm is plain LCS — O(L*R) time and space — but it operates
 * on per-row signatures rather than individual bytes, so for the
 * 16-byte default block size the constants are 256× smaller than a
 * character-level diff would be.
 */
export function diffHex(
  left: Uint8Array,
  right: Uint8Array,
  options: HexDiffOptions = {},
): HexDiffResult {
  const blockSize = options.blockSize ?? HEX_DIFF_BLOCK_SIZE;
  if (!Number.isInteger(blockSize) || blockSize <= 0) {
    throw new Error(`diffHex: blockSize must be a positive integer (got ${blockSize})`);
  }

  const leftRows = Math.ceil(left.length / blockSize);
  const rightRows = Math.ceil(right.length / blockSize);
  const identical = bytesEqual(left, right);

  if (leftRows + rightRows > MAX_HEX_DIFF_BLOCKS) {
    return {
      segments: identical
        ? [{ kind: 'equal', leftOffset: 0, rightOffset: 0, rows: leftRows }]
        : [
            {
              kind: 'change',
              leftRows,
              rightRows,
              ...(leftRows > 0 ? { leftOffset: 0 } : {}),
              ...(rightRows > 0 ? { rightOffset: 0 } : {}),
            },
          ],
      leftRows,
      rightRows,
      identical,
      truncated: true,
    };
  }

  const leftSig = signatures(left, blockSize, leftRows);
  const rightSig = signatures(right, blockSize, rightRows);
  const lcs = computeLcs(leftSig, rightSig);
  const segments = walkSegments(lcs, leftSig, rightSig, left, right, blockSize);

  return { segments, leftRows, rightRows, identical, truncated: false };
}

/**
 * Materialise the byte view for a given hex row on either side. Out of
 * range rows return an empty `Uint8Array` so the caller can render a
 * placeholder gutter cell.
 */
export function rowSlice(
  buf: Uint8Array,
  row: number,
  blockSize: number = HEX_DIFF_BLOCK_SIZE,
): Uint8Array {
  if (row < 0) return new Uint8Array(0);
  const start = row * blockSize;
  if (start >= buf.length) return new Uint8Array(0);
  return buf.subarray(start, Math.min(buf.length, start + blockSize));
}

/**
 * Format a single byte as two uppercase hex digits.
 */
export function formatHexByte(byte: number): string {
  return (byte & 0xff).toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Format a byte offset as `00000000` (8 hex digits — 4 GiB addressable).
 * Wraps modulo 2^32 to keep the fixed width.
 */
export function formatHexOffset(offset: number): string {
  return ((offset >>> 0).toString(16)).padStart(8, '0').toUpperCase();
}

/**
 * Map a byte to its printable ASCII glyph for the right-hand "ASCII
 * panel" of a hex view. Non-printables collapse to `'.'`.
 */
export function asciiGlyph(byte: number): string {
  const b = byte & 0xff;
  if (b >= 0x20 && b <= 0x7e) return String.fromCharCode(b);
  return '.';
}

// ---- internals ---------------------------------------------------------

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 32-bit FNV-1a over a byte slice. Plenty of collision resistance for
 * the LCS comparison step (we only ever compare pairs of blocks of the
 * same byte length).
 */
function fnv1a32(buf: Uint8Array, start: number, end: number): number {
  let hash = 0x811c9dc5;
  for (let i = start; i < end; i += 1) {
    hash ^= buf[i] ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

interface BlockSig {
  hash: number;
  start: number;
  end: number;
}

function signatures(buf: Uint8Array, blockSize: number, rows: number): BlockSig[] {
  const out: BlockSig[] = new Array(rows);
  for (let i = 0; i < rows; i += 1) {
    const start = i * blockSize;
    const end = Math.min(buf.length, start + blockSize);
    out[i] = { hash: fnv1a32(buf, start, end), start, end };
  }
  return out;
}

function blocksEqual(buf1: Uint8Array, a: BlockSig, buf2: Uint8Array, b: BlockSig): boolean {
  if (a.hash !== b.hash) return false;
  const lenA = a.end - a.start;
  const lenB = b.end - b.start;
  if (lenA !== lenB) return false;
  for (let i = 0; i < lenA; i += 1) {
    if (buf1[a.start + i] !== buf2[b.start + i]) return false;
  }
  return true;
}

/**
 * Compute the LCS table over block hashes. Returns the full DP matrix;
 * we use it during back-walk to emit segments.
 */
function computeLcs(left: BlockSig[], right: BlockSig[]): Uint32Array {
  const cols = right.length + 1;
  const dp = new Uint32Array((left.length + 1) * cols);
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const idx = i * cols + j;
      const li = left[i - 1];
      const rj = right[j - 1];
      // Compare hash only; hash collisions are reconciled when emitting
      // segments (see `walkSegments`).
      if (li && rj && li.hash === rj.hash) {
        dp[idx] = (dp[idx - cols - 1] ?? 0) + 1;
      } else {
        const up = dp[idx - cols] ?? 0;
        const left_ = dp[idx - 1] ?? 0;
        dp[idx] = up >= left_ ? up : left_;
      }
    }
  }
  return dp;
}

function walkSegments(
  dp: Uint32Array,
  left: BlockSig[],
  right: BlockSig[],
  leftBuf: Uint8Array,
  rightBuf: Uint8Array,
  blockSize: number,
): HexDiffSegment[] {
  const cols = right.length + 1;
  const segments: HexDiffSegment[] = [];
  let i = left.length;
  let j = right.length;

  type Op =
    | { kind: 'equal'; li: number; rj: number }
    | { kind: 'left'; li: number }
    | { kind: 'right'; rj: number };
  const ops: Op[] = [];

  while (i > 0 && j > 0) {
    const li = left[i - 1];
    const rj = right[j - 1];
    if (li && rj && li.hash === rj.hash) {
      ops.push({ kind: 'equal', li: i - 1, rj: j - 1 });
      i -= 1;
      j -= 1;
      continue;
    }
    const up = dp[(i - 1) * cols + j] ?? 0;
    const left_ = dp[i * cols + (j - 1)] ?? 0;
    if (up >= left_) {
      ops.push({ kind: 'left', li: i - 1 });
      i -= 1;
    } else {
      ops.push({ kind: 'right', rj: j - 1 });
      j -= 1;
    }
  }
  while (i > 0) {
    ops.push({ kind: 'left', li: i - 1 });
    i -= 1;
  }
  while (j > 0) {
    ops.push({ kind: 'right', rj: j - 1 });
    j -= 1;
  }
  ops.reverse();

  // Coalesce consecutive ops into segments. A run of `equal` becomes
  // an `equal` segment; runs of `left`/`right` (in any order) become a
  // single `change` segment.
  let pendingLeftStart: number | null = null;
  let pendingRightStart: number | null = null;
  let pendingLeftRows = 0;
  let pendingRightRows = 0;
  let pendingEqualLeft: number | null = null;
  let pendingEqualRight: number | null = null;
  let pendingEqualRows = 0;

  const flushChange = (): void => {
    if (pendingLeftRows === 0 && pendingRightRows === 0) return;
    const seg: HexDiffSegment = {
      kind: 'change',
      leftRows: pendingLeftRows,
      rightRows: pendingRightRows,
      ...(pendingLeftRows > 0 && pendingLeftStart !== null
        ? { leftOffset: pendingLeftStart * blockSize }
        : {}),
      ...(pendingRightRows > 0 && pendingRightStart !== null
        ? { rightOffset: pendingRightStart * blockSize }
        : {}),
    };
    segments.push(seg);
    pendingLeftStart = null;
    pendingRightStart = null;
    pendingLeftRows = 0;
    pendingRightRows = 0;
  };

  const flushEqual = (): void => {
    if (pendingEqualRows === 0) return;
    segments.push({
      kind: 'equal',
      leftOffset: (pendingEqualLeft ?? 0) * blockSize,
      rightOffset: (pendingEqualRight ?? 0) * blockSize,
      rows: pendingEqualRows,
    });
    pendingEqualLeft = null;
    pendingEqualRight = null;
    pendingEqualRows = 0;
  };

  for (const op of ops) {
    if (op.kind === 'equal') {
      // Reconcile possible hash collision: if the bytes don't actually
      // match, demote to a 1×1 change segment.
      const li = left[op.li];
      const rj = right[op.rj];
      const truly = li && rj ? blocksEqual(leftBuf, li, rightBuf, rj) : false;
      if (!truly) {
        flushEqual();
        if (pendingLeftStart === null) pendingLeftStart = op.li;
        if (pendingRightStart === null) pendingRightStart = op.rj;
        pendingLeftRows += 1;
        pendingRightRows += 1;
        continue;
      }
      flushChange();
      if (pendingEqualRows === 0) {
        pendingEqualLeft = op.li;
        pendingEqualRight = op.rj;
      }
      pendingEqualRows += 1;
    } else if (op.kind === 'left') {
      flushEqual();
      if (pendingLeftStart === null) pendingLeftStart = op.li;
      pendingLeftRows += 1;
    } else {
      flushEqual();
      if (pendingRightStart === null) pendingRightStart = op.rj;
      pendingRightRows += 1;
    }
  }
  flushEqual();
  flushChange();

  return segments;
}
