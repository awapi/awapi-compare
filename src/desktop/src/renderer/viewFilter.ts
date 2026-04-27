import type { ComparedPair, DiffStatus } from '@awapi/shared';

/**
 * Renderer-only "show what?" filter applied on top of a scan result.
 *
 * - `'all'`   — show every pair / line / hex row.
 * - `'diffs'` — show only differing rows (and the directory ancestors
 *               that contain them, so the tree stays navigable).
 * - `'same'`  — show only identical rows (and their directory
 *               ancestors).
 *
 * Pure UI state: not persisted in `SessionSnapshot`, not part of any
 * IPC contract.
 */
export type ViewFilter = 'all' | 'diffs' | 'same';

const DIFFERING_STATUSES: ReadonlySet<DiffStatus> = new Set<DiffStatus>([
  'left-only',
  'right-only',
  'different',
  'newer-left',
  'newer-right',
  'error',
]);

const SAME_STATUSES: ReadonlySet<DiffStatus> = new Set<DiffStatus>([
  'identical',
  'excluded',
]);

function parentOf(relPath: string): string {
  const i = Math.max(relPath.lastIndexOf('/'), relPath.lastIndexOf('\\'));
  return i < 0 ? '' : relPath.slice(0, i);
}

function isDirPair(pair: ComparedPair): boolean {
  return pair.left?.type === 'dir' || pair.right?.type === 'dir';
}

/**
 * Filter a flat pair list according to `mode`. Pure & electron-free.
 *
 * Strategy: classify each non-dir pair, then re-include the chain of
 * directory-pair ancestors so the surviving entries still appear under
 * their parent folders in the tree view. Directory pairs that are
 * themselves "diffs" (e.g. `left-only` folder) are kept in `'diffs'`
 * mode even though their children are not enumerated.
 */
export function filterPairs(
  pairs: readonly ComparedPair[],
  mode: ViewFilter,
): ComparedPair[] {
  if (mode === 'all') return pairs.slice();

  const target = mode === 'diffs' ? DIFFERING_STATUSES : SAME_STATUSES;
  const known = new Set<string>();
  for (const pair of pairs) known.add(pair.relPath);

  const keep = new Set<string>();
  const includeAncestors = (relPath: string): void => {
    let parent = parentOf(relPath);
    while (parent !== '') {
      if (known.has(parent)) keep.add(parent);
      parent = parentOf(parent);
    }
  };

  for (const pair of pairs) {
    const dir = isDirPair(pair);
    if (!dir && target.has(pair.status)) {
      keep.add(pair.relPath);
      includeAncestors(pair.relPath);
    } else if (dir && mode === 'diffs' && DIFFERING_STATUSES.has(pair.status)) {
      // Whole folder is left-only / right-only / errored.
      keep.add(pair.relPath);
      includeAncestors(pair.relPath);
    }
  }

  return pairs.filter((p) => keep.has(p.relPath));
}

/**
 * Result of applying a {@link ViewFilter} to a pair of text buffers.
 *
 * `applied` is `false` when the input was empty, the filter was
 * `'all'`, or the buffers exceeded {@link MAX_FILTERABLE_LINES} on
 * either side — in which case the original text passes through.
 */
export interface FilteredText {
  leftText: string;
  rightText: string;
  applied: boolean;
}

/**
 * Hard cap on the number of lines per side we are willing to LCS.
 * The naive O(m·n) DP underneath is fine for typical source files but
 * would lock the renderer for very large logs; bail out and return the
 * unfiltered text instead.
 */
export const MAX_FILTERABLE_LINES = 5000;

/**
 * Filter two text buffers down to either their differing lines
 * (`'diffs'`) or their common lines (`'same'`) by way of a basic
 * line-level LCS.
 */
export function filterTextLines(
  leftText: string | null,
  rightText: string | null,
  mode: ViewFilter,
): FilteredText {
  const left = leftText ?? '';
  const right = rightText ?? '';
  if (mode === 'all') {
    return { leftText: left, rightText: right, applied: false };
  }

  const leftLines = left.length === 0 ? [] : left.split(/\r?\n/u);
  const rightLines = right.length === 0 ? [] : right.split(/\r?\n/u);

  if (
    leftLines.length > MAX_FILTERABLE_LINES ||
    rightLines.length > MAX_FILTERABLE_LINES
  ) {
    return { leftText: left, rightText: right, applied: false };
  }

  const matches = lcsLineMatches(leftLines, rightLines);
  const matchedLeft = new Set<number>();
  const matchedRight = new Set<number>();
  for (const [li, ri] of matches) {
    matchedLeft.add(li);
    matchedRight.add(ri);
  }

  const pickLeft: string[] = [];
  const pickRight: string[] = [];
  if (mode === 'same') {
    for (const [li, ri] of matches) {
      pickLeft.push(leftLines[li] ?? '');
      pickRight.push(rightLines[ri] ?? '');
    }
  } else {
    // 'diffs'
    for (let i = 0; i < leftLines.length; i += 1) {
      if (!matchedLeft.has(i)) pickLeft.push(leftLines[i] ?? '');
    }
    for (let i = 0; i < rightLines.length; i += 1) {
      if (!matchedRight.has(i)) pickRight.push(rightLines[i] ?? '');
    }
  }

  return {
    leftText: pickLeft.join('\n'),
    rightText: pickRight.join('\n'),
    applied: true,
  };
}

/**
 * Compute a line-level Longest Common Subsequence and return the
 * matched index pairs in ascending order.
 */
function lcsLineMatches(left: readonly string[], right: readonly string[]): Array<[number, number]> {
  const m = left.length;
  const n = right.length;
  if (m === 0 || n === 0) return [];

  // dp[i][j] = LCS length of left[0..i) vs right[0..j)
  const dp: Uint32Array[] = new Array(m + 1);
  for (let i = 0; i <= m; i += 1) dp[i] = new Uint32Array(n + 1);

  for (let i = 1; i <= m; i += 1) {
    const li = left[i - 1];
    const row = dp[i] as Uint32Array;
    const prev = dp[i - 1] as Uint32Array;
    for (let j = 1; j <= n; j += 1) {
      if (li === right[j - 1]) {
        row[j] = (prev[j - 1] ?? 0) + 1;
      } else {
        const a = prev[j] ?? 0;
        const b = row[j - 1] ?? 0;
        row[j] = a >= b ? a : b;
      }
    }
  }

  const out: Array<[number, number]> = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const row = dp[i] as Uint32Array;
    const prev = dp[i - 1] as Uint32Array;
    if (left[i - 1] === right[j - 1]) {
      out.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if ((prev[j] ?? 0) >= (row[j - 1] ?? 0)) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  out.reverse();
  return out;
}
