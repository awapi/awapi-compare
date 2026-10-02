/**
 * Pure logic behind three-way merge: a line diff (Myers), a diff3
 * region builder, and helpers that turn per-region choices into merged
 * text. No Electron / React / Monaco imports so everything is unit-testable.
 *
 * Vocabulary: `base` is the common ancestor, `left` and `right` are the two
 * edited versions. The merge is expressed as a list of {@link MergeRegion}s
 * that tile all three documents end to end.
 */

/** A change between two line arrays; ranges are 0-based, end-exclusive. */
export interface DiffHunk {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

/**
 * Upper bound on the Myers edit distance explored before giving up and
 * reporting the whole differing middle as one replacement. Keeps memory
 * (O(D²)) bounded for wildly different files; the result is still a
 * valid, just coarser, diff.
 */
export const MAX_EDIT_DISTANCE = 3000;

/**
 * Line-level diff of `a` against `b`. Returns the minimal set of hunks (up
 * to {@link MAX_EDIT_DISTANCE}) that turn `a` into `b`, in ascending order.
 */
export function diffLines(
  a: readonly string[],
  b: readonly string[],
  maxEditDistance: number = MAX_EDIT_DISTANCE,
): DiffHunk[] {
  let prefix = 0;
  const minLen = Math.min(a.length, b.length);
  while (prefix < minLen && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < minLen - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
    suffix++;
  }
  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);
  if (aMid.length === 0 && bMid.length === 0) return [];

  const whole: DiffHunk = {
    aStart: prefix,
    aEnd: prefix + aMid.length,
    bStart: prefix,
    bEnd: prefix + bMid.length,
  };
  if (aMid.length === 0 || bMid.length === 0) return [whole];

  const hunks = myers(aMid, bMid, maxEditDistance);
  if (hunks === null) return [whole];
  return hunks.map((h) => ({
    aStart: h.aStart + prefix,
    aEnd: h.aEnd + prefix,
    bStart: h.bStart + prefix,
    bEnd: h.bEnd + prefix,
  }));
}

/** Myers O(ND) diff. Returns `null` when the edit distance exceeds `cap`. */
function myers(a: readonly string[], b: readonly string[], cap: number): DiffHunk[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, cap);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] is a copy of the furthest-reaching x per diagonal *before*
  // round d, restricted to diagonals -d-1 .. d+1 (index k + d + 1).
  const trace: Int32Array[] = [];

  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))) {
        x = v[offset + k + 1] ?? 0;
      } else {
        x = (v[offset + k - 1] ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;

  const edits: DiffHunk[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d];
    if (!prev) return null;
    const k = x - y;
    const at = (kk: number): number => prev[kk + d + 1] ?? 0;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
    }
    // One non-diagonal step from (prevX, prevY): a deletion or an insertion.
    edits.push(
      x > prevX
        ? { aStart: prevX, aEnd: prevX + 1, bStart: prevY, bEnd: prevY }
        : { aStart: prevX, aEnd: prevX, bStart: prevY, bEnd: prevY + 1 },
    );
    x = prevX;
    y = prevY;
  }
  edits.reverse();

  const hunks: DiffHunk[] = [];
  for (const e of edits) {
    const last = hunks[hunks.length - 1];
    if (last && last.aEnd === e.aStart && last.bEnd === e.bStart) {
      last.aEnd = e.aEnd;
      last.bEnd = e.bEnd;
    } else {
      hunks.push({ ...e });
    }
  }
  return hunks;
}

// ---- Three-way merge ----------------------------------------------------

/**
 * - `stable`: identical in all three documents.
 * - `left` / `right`: changed on that side only (auto-merged).
 * - `both`: changed identically on both sides (auto-merged).
 * - `conflict`: changed differently on both sides.
 */
export type MergeRegionKind = 'stable' | 'left' | 'right' | 'both' | 'conflict';

/** Ranges are 0-based line indices, end-exclusive, into each document. */
export interface MergeRegion {
  kind: MergeRegionKind;
  baseStart: number;
  baseEnd: number;
  leftStart: number;
  leftEnd: number;
  rightStart: number;
  rightEnd: number;
}

export interface Merge3Result {
  base: readonly string[];
  left: readonly string[];
  right: readonly string[];
  regions: MergeRegion[];
}

export type MergeSide = 'base' | 'left' | 'right';

/** How to resolve one region. */
export type MergeChoice = 'base' | 'left' | 'right' | 'leftThenRight' | 'rightThenLeft';

interface SideHunk extends DiffHunk {
  side: 'left' | 'right';
}

/**
 * Three-way merge of line arrays. Changes whose base ranges overlap or
 * touch are grouped into one region (as `git merge` / `diff3` do): the
 * region is a conflict unless both sides produced identical lines.
 */
export function merge3(
  base: readonly string[],
  left: readonly string[],
  right: readonly string[],
): Merge3Result {
  const hunks: SideHunk[] = [
    ...diffLines(base, left).map((h): SideHunk => ({ ...h, side: 'left' })),
    ...diffLines(base, right).map((h): SideHunk => ({ ...h, side: 'right' })),
  ].sort((p, q) => p.aStart - q.aStart || p.aEnd - q.aEnd);

  const regions: MergeRegion[] = [];
  let basePos = 0;
  let leftOff = 0; // left index = base index + leftOff outside of changes
  let rightOff = 0;

  let i = 0;
  while (i < hunks.length) {
    const first = hunks[i] as SideHunk;
    const groupStart = first.aStart;
    let groupEnd = first.aEnd;
    const group: SideHunk[] = [first];
    let j = i + 1;
    while (j < hunks.length && (hunks[j] as SideHunk).aStart <= groupEnd) {
      const h = hunks[j] as SideHunk;
      group.push(h);
      groupEnd = Math.max(groupEnd, h.aEnd);
      j++;
    }
    i = j;

    if (groupStart > basePos) {
      regions.push({
        kind: 'stable',
        baseStart: basePos,
        baseEnd: groupStart,
        leftStart: basePos + leftOff,
        leftEnd: groupStart + leftOff,
        rightStart: basePos + rightOff,
        rightEnd: groupStart + rightOff,
      });
    }

    const lh = group.filter((h) => h.side === 'left');
    const rh = group.filter((h) => h.side === 'right');
    const [leftStart, leftEnd] = mapRange(lh, groupStart, groupEnd, leftOff);
    const [rightStart, rightEnd] = mapRange(rh, groupStart, groupEnd, rightOff);

    let kind: MergeRegionKind;
    if (rh.length === 0) kind = 'left';
    else if (lh.length === 0) kind = 'right';
    else
      kind = sliceEquals(left, leftStart, leftEnd, right, rightStart, rightEnd)
        ? 'both'
        : 'conflict';

    regions.push({
      kind,
      baseStart: groupStart,
      baseEnd: groupEnd,
      leftStart,
      leftEnd,
      rightStart,
      rightEnd,
    });
    leftOff = leftEnd - groupEnd;
    rightOff = rightEnd - groupEnd;
    basePos = groupEnd;
  }

  if (basePos < base.length) {
    regions.push({
      kind: 'stable',
      baseStart: basePos,
      baseEnd: base.length,
      leftStart: basePos + leftOff,
      leftEnd: base.length + leftOff,
      rightStart: basePos + rightOff,
      rightEnd: base.length + rightOff,
    });
  }

  return { base, left, right, regions };
}

/** Map a base range onto one side given that side's hunks inside the range. */
function mapRange(
  sideHunks: readonly SideHunk[],
  groupStart: number,
  groupEnd: number,
  offset: number,
): [number, number] {
  const first = sideHunks[0];
  const last = sideHunks[sideHunks.length - 1];
  if (!first || !last) return [groupStart + offset, groupEnd + offset];
  return [first.bStart - (first.aStart - groupStart), last.bEnd + (groupEnd - last.aEnd)];
}

function sliceEquals(
  a: readonly string[],
  aStart: number,
  aEnd: number,
  b: readonly string[],
  bStart: number,
  bEnd: number,
): boolean {
  if (aEnd - aStart !== bEnd - bStart) return false;
  for (let k = 0; k < aEnd - aStart; k++) {
    if (a[aStart + k] !== b[bStart + k]) return false;
  }
  return true;
}

/** Lines of region `index` in the given document. */
export function regionLines(merge: Merge3Result, index: number, side: MergeSide): string[] {
  const r = merge.regions[index];
  if (!r) return [];
  if (side === 'base') return merge.base.slice(r.baseStart, r.baseEnd);
  if (side === 'left') return merge.left.slice(r.leftStart, r.leftEnd);
  return merge.right.slice(r.rightStart, r.rightEnd);
}

/** Lines that result from resolving region `index` with `choice`. */
export function choiceLines(merge: Merge3Result, index: number, choice: MergeChoice): string[] {
  switch (choice) {
    case 'base':
      return regionLines(merge, index, 'base');
    case 'left':
      return regionLines(merge, index, 'left');
    case 'right':
      return regionLines(merge, index, 'right');
    case 'leftThenRight':
      return [...regionLines(merge, index, 'left'), ...regionLines(merge, index, 'right')];
    case 'rightThenLeft':
      return [...regionLines(merge, index, 'right'), ...regionLines(merge, index, 'left')];
  }
}

export const CONFLICT_MARKER_LEFT = '<<<<<<< left';
export const CONFLICT_MARKER_SEPARATOR = '=======';
export const CONFLICT_MARKER_RIGHT = '>>>>>>> right';

/** Git-style conflict block for an unresolved region. */
export function conflictMarkerLines(
  leftLines: readonly string[],
  rightLines: readonly string[],
): string[] {
  return [
    CONFLICT_MARKER_LEFT,
    ...leftLines,
    CONFLICT_MARKER_SEPARATOR,
    ...rightLines,
    CONFLICT_MARKER_RIGHT,
  ];
}

/** True when `lines` still contain a conflict marker produced by {@link conflictMarkerLines}. */
export function hasConflictMarkers(lines: readonly string[]): boolean {
  return lines.some(
    (l) =>
      l === CONFLICT_MARKER_LEFT || l === CONFLICT_MARKER_SEPARATOR || l === CONFLICT_MARKER_RIGHT,
  );
}

/**
 * The merged lines before the user does anything: stable text as-is,
 * one-sided and identical changes applied, conflicts as marker blocks.
 */
export function defaultRegionLines(merge: Merge3Result, index: number): string[] {
  const r = merge.regions[index];
  if (!r) return [];
  switch (r.kind) {
    case 'stable':
      return regionLines(merge, index, 'base');
    case 'left':
    case 'both':
      return regionLines(merge, index, 'left');
    case 'right':
      return regionLines(merge, index, 'right');
    case 'conflict':
      return conflictMarkerLines(
        regionLines(merge, index, 'left'),
        regionLines(merge, index, 'right'),
      );
  }
}

/** 0-based, end-exclusive line span of a region inside the merged document. */
export interface LineSpan {
  start: number;
  end: number;
}

export interface MergedDocument {
  lines: string[];
  /** One span per region, same order as {@link Merge3Result.regions}. */
  spans: LineSpan[];
}

/** Assemble the initial merged document and where each region sits in it. */
export function buildInitialResult(merge: Merge3Result): MergedDocument {
  const lines: string[] = [];
  const spans: LineSpan[] = [];
  merge.regions.forEach((_r, index) => {
    const start = lines.length;
    lines.push(...defaultRegionLines(merge, index));
    spans.push({ start, end: lines.length });
  });
  return { lines, spans };
}

/** Number of regions that need the user's attention (conflicts). */
export function countConflicts(merge: Merge3Result): number {
  return merge.regions.filter((r) => r.kind === 'conflict').length;
}

export type StepFilter = 'changes' | 'conflicts';

/**
 * Index of the next / previous region matching `filter`, wrapping around.
 * `current` may be `-1` (nothing selected). Returns `-1` when none match.
 */
export function stepRegion(
  regions: readonly MergeRegion[],
  current: number,
  direction: 1 | -1,
  filter: StepFilter = 'changes',
): number {
  const n = regions.length;
  if (n === 0) return -1;
  const matches = (r: MergeRegion): boolean =>
    filter === 'conflicts' ? r.kind === 'conflict' : r.kind !== 'stable';
  const startFrom = current < 0 ? (direction === 1 ? -1 : n) : current;
  for (let step = 1; step <= n; step++) {
    const idx = (((startFrom + direction * step) % n) + n) % n;
    if (matches(regions[idx] as MergeRegion)) return idx;
  }
  return -1;
}

// ---- Text <-> lines -----------------------------------------------------

export type Eol = '\n' | '\r\n';

export interface SplitText {
  lines: string[];
  eol: Eol;
  /** Whether the text ended with a line terminator. */
  finalNewline: boolean;
}

/** Split text on `\n`, `\r\n` or `\r`, remembering the dominant EOL style. */
export function splitLines(text: string): SplitText {
  if (text === '') return { lines: [], eol: '\n', finalNewline: false };
  const eol: Eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\n|\r/u);
  const finalNewline = lines[lines.length - 1] === '';
  if (finalNewline) lines.pop();
  return { lines, eol, finalNewline };
}

export function joinLines(lines: readonly string[], eol: Eol, finalNewline: boolean): string {
  if (lines.length === 0) return '';
  return lines.join(eol) + (finalNewline ? eol : '');
}

/**
 * Convenience: merge three texts. Returns the merge plus the line-ending
 * style to write back (CRLF when any input uses it) and whether the output should end with a newline (when any input does).
 */
export function mergeTexts(
  baseText: string,
  leftText: string,
  rightText: string,
): { merge: Merge3Result; eol: Eol; finalNewline: boolean } {
  const base = splitLines(baseText);
  const left = splitLines(leftText);
  const right = splitLines(rightText);
  const eolSource = [left, right, base].find((s) => s.lines.length > 0 && s.eol === '\r\n');
  return {
    merge: merge3(base.lines, left.lines, right.lines),
    eol: eolSource ? '\r\n' : '\n',
    finalNewline: left.finalNewline || right.finalNewline || base.finalNewline,
  };
}
