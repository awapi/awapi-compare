import { describe, expect, it } from 'vitest';
import {
  buildInitialResult,
  choiceLines,
  conflictMarkerLines,
  countConflicts,
  defaultRegionLines,
  diffLines,
  hasConflictMarkers,
  joinLines,
  merge3,
  mergeTexts,
  regionLines,
  splitLines,
  stepRegion,
  type DiffHunk,
  type Merge3Result,
  type MergeRegion,
} from './merge3.js';

const L = (s: string): string[] => (s === '' ? [] : s.split(' '));

function applyHunks(a: readonly string[], b: readonly string[], hunks: DiffHunk[]): string[] {
  const out: string[] = [];
  let pos = 0;
  for (const h of hunks) {
    out.push(...a.slice(pos, h.aStart), ...b.slice(h.bStart, h.bEnd));
    pos = h.aEnd;
  }
  out.push(...a.slice(pos));
  return out;
}

/** Concatenating one document's slice of every region must rebuild it. */
function expectTiling(m: Merge3Result): void {
  const cat = (key: 'base' | 'left' | 'right'): string[] =>
    m.regions.flatMap((_r, i) => regionLines(m, i, key));
  expect(cat('base')).toEqual([...m.base]);
  expect(cat('left')).toEqual([...m.left]);
  expect(cat('right')).toEqual([...m.right]);
}

function kinds(m: Merge3Result): string[] {
  return m.regions.map((r) => r.kind);
}

describe('diffLines', () => {
  it('returns no hunks for identical input', () => {
    expect(diffLines(L('a b c'), L('a b c'))).toEqual([]);
    expect(diffLines([], [])).toEqual([]);
  });

  it('reports pure insertions and deletions', () => {
    expect(diffLines([], L('a b'))).toEqual([{ aStart: 0, aEnd: 0, bStart: 0, bEnd: 2 }]);
    expect(diffLines(L('a b'), [])).toEqual([{ aStart: 0, aEnd: 2, bStart: 0, bEnd: 0 }]);
    expect(diffLines(L('a c'), L('a b c'))).toEqual([{ aStart: 1, aEnd: 1, bStart: 1, bEnd: 2 }]);
    expect(diffLines(L('a b c'), L('a c'))).toEqual([{ aStart: 1, aEnd: 2, bStart: 1, bEnd: 1 }]);
  });

  it('reports a replacement as a single hunk', () => {
    expect(diffLines(L('a b c'), L('a x c'))).toEqual([{ aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 }]);
  });

  it('finds multiple separate hunks', () => {
    const hunks = diffLines(L('a b c d e f'), L('a X c d Y f'));
    expect(hunks).toEqual([
      { aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 },
      { aStart: 4, aEnd: 5, bStart: 4, bEnd: 5 },
    ]);
  });

  it('is minimal for a classic Myers example', () => {
    const a = L('A B C A B B A');
    const b = L('C B A B A C');
    const hunks = diffLines(a, b);
    const edits = hunks.reduce((n, h) => n + (h.aEnd - h.aStart) + (h.bEnd - h.bStart), 0);
    expect(edits).toBe(5);
    expect(applyHunks(a, b, hunks)).toEqual(b);
  });

  it('falls back to one coarse hunk when the edit distance cap is exceeded', () => {
    const a = L('a b c d e f g h');
    const b = L('1 2 3 4 5 6 7 8');
    expect(diffLines(a, b, 2)).toEqual([{ aStart: 0, aEnd: 8, bStart: 0, bEnd: 8 }]);
  });

  it('applying the hunks always reproduces the target (randomised)', () => {
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let iter = 0; iter < 200; iter++) {
      const a = Array.from({ length: rnd(15) }, () => String(rnd(4)));
      const b = Array.from({ length: rnd(15) }, () => String(rnd(4)));
      const hunks = diffLines(a, b);
      expect(applyHunks(a, b, hunks)).toEqual(b);
      for (let i = 1; i < hunks.length; i++) {
        const prev = hunks[i - 1] as DiffHunk;
        const cur = hunks[i] as DiffHunk;
        expect(cur.aStart).toBeGreaterThanOrEqual(prev.aEnd);
        expect(cur.bStart).toBeGreaterThanOrEqual(prev.bEnd);
      }
    }
  });
});

describe('merge3', () => {
  it('treats identical documents as one stable region', () => {
    const m = merge3(L('a b c'), L('a b c'), L('a b c'));
    expect(kinds(m)).toEqual(['stable']);
    expectTiling(m);
  });

  it('handles three empty documents', () => {
    const m = merge3([], [], []);
    expect(m.regions).toEqual([]);
    expect(countConflicts(m)).toBe(0);
  });

  it('applies a left-only change', () => {
    const m = merge3(L('a b c'), L('a X c'), L('a b c'));
    expect(kinds(m)).toEqual(['stable', 'left', 'stable']);
    expect(buildInitialResult(m).lines).toEqual(L('a X c'));
    expectTiling(m);
  });

  it('applies a right-only change', () => {
    const m = merge3(L('a b c'), L('a b c'), L('a b Y'));
    expect(kinds(m)).toEqual(['stable', 'right']);
    expect(buildInitialResult(m).lines).toEqual(L('a b Y'));
    expectTiling(m);
  });

  it('merges non-overlapping changes from both sides', () => {
    const m = merge3(L('a b c d e'), L('A b c d e'), L('a b c d E'));
    expect(kinds(m)).toEqual(['left', 'stable', 'right']);
    expect(buildInitialResult(m).lines).toEqual(L('A b c d E'));
    expect(countConflicts(m)).toBe(0);
    expectTiling(m);
  });

  it('flags identical changes on both sides as auto-resolved', () => {
    const m = merge3(L('a b c'), L('a X c'), L('a X c'));
    expect(kinds(m)).toEqual(['stable', 'both', 'stable']);
    expect(buildInitialResult(m).lines).toEqual(L('a X c'));
    expectTiling(m);
  });

  it('reports different changes to the same line as a conflict', () => {
    const m = merge3(L('a b c'), L('a L c'), L('a R c'));
    expect(kinds(m)).toEqual(['stable', 'conflict', 'stable']);
    expect(countConflicts(m)).toBe(1);
    expect(defaultRegionLines(m, 1)).toEqual([
      '<<<<<<< left',
      'L',
      '=======',
      'R',
      '>>>>>>> right',
    ]);
    expectTiling(m);
  });

  it('treats a change plus a deletion of the same line as a conflict', () => {
    const m = merge3(L('a b c'), L('a L c'), L('a c'));
    expect(kinds(m)).toEqual(['stable', 'conflict', 'stable']);
    expect(regionLines(m, 1, 'right')).toEqual([]);
    expectTiling(m);
  });

  it('treats adjacent changes as a conflict, like git', () => {
    const m = merge3(L('a b c d'), L('a L c d'), L('a b R d'));
    expect(kinds(m)).toEqual(['stable', 'conflict', 'stable']);
    expect(regionLines(m, 1, 'base')).toEqual(L('b c'));
    expect(regionLines(m, 1, 'left')).toEqual(L('L c'));
    expect(regionLines(m, 1, 'right')).toEqual(L('b R'));
    expectTiling(m);
  });

  it('conflicts when both sides insert different text at the same point', () => {
    const m = merge3(L('a c'), L('a L c'), L('a R c'));
    expect(kinds(m)).toEqual(['stable', 'conflict', 'stable']);
    expect(regionLines(m, 1, 'base')).toEqual([]);
    expectTiling(m);
  });

  it('resolves identical insertions at the same point', () => {
    const m = merge3(L('a c'), L('a X c'), L('a X c'));
    expect(kinds(m)).toEqual(['stable', 'both', 'stable']);
    expectTiling(m);
  });

  it('handles both sides deleting the same line', () => {
    const m = merge3(L('a b c'), L('a c'), L('a c'));
    expect(kinds(m)).toEqual(['stable', 'both', 'stable']);
    expect(buildInitialResult(m).lines).toEqual(L('a c'));
    expectTiling(m);
  });

  it('merges changes in an empty base (add/add)', () => {
    const m = merge3([], L('a'), L('b'));
    expect(kinds(m)).toEqual(['conflict']);
    const same = merge3([], L('a'), L('a'));
    expect(kinds(same)).toEqual(['both']);
    expectTiling(m);
    expectTiling(same);
  });

  it('keeps region line spans consistent with the initial document', () => {
    const m = merge3(L('a b c d e'), L('a L c d e2'), L('a R c d e'));
    const doc = buildInitialResult(m);
    expect(doc.spans).toHaveLength(m.regions.length);
    m.regions.forEach((_r, i) => {
      const span = doc.spans[i];
      expect(doc.lines.slice(span?.start, span?.end)).toEqual(defaultRegionLines(m, i));
    });
    expect(doc.spans[doc.spans.length - 1]?.end).toBe(doc.lines.length);
  });

  it('keeps tiling and no-lost-edits invariants (randomised)', () => {
    let seed = 987;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const mutate = (doc: string[]): string[] => {
      const out = [...doc];
      for (let e = rnd(4); e > 0; e--) {
        const at = rnd(out.length + 1);
        const op = rnd(3);
        if (op === 0) out.splice(at, 0, `n${rnd(5)}`);
        else if (op === 1) out.splice(at, 1);
        else if (at < out.length) out[at] = `m${rnd(5)}`;
      }
      return out;
    };
    for (let iter = 0; iter < 300; iter++) {
      const base = Array.from({ length: rnd(12) }, (_v, i) => `b${i}`);
      const left = mutate(base);
      const right = mutate(base);
      const m = merge3(base, left, right);
      expectTiling(m);
      // With no conflicts the merged text must equal each side's change
      // applied on top of the other.
      if (countConflicts(m) === 0) {
        const merged = buildInitialResult(m).lines;
        const leftOnly = m.regions.every(
          (r) => r.kind === 'stable' || r.kind === 'left' || r.kind === 'both',
        );
        if (leftOnly) expect(merged).toEqual(left);
      }
      // Taking "left" everywhere reproduces the left document.
      const takeLeft = m.regions.flatMap((_r, i) => choiceLines(m, i, 'left'));
      expect(takeLeft).toEqual(left);
      const takeRight = m.regions.flatMap((_r, i) => choiceLines(m, i, 'right'));
      expect(takeRight).toEqual(right);
      const takeBase = m.regions.flatMap((_r, i) => choiceLines(m, i, 'base'));
      expect(takeBase).toEqual(base);
    }
  });
});

describe('choiceLines', () => {
  const m = merge3(L('a b c'), L('a L c'), L('a R c'));
  it('returns each side and the two concatenations', () => {
    expect(choiceLines(m, 1, 'base')).toEqual(['b']);
    expect(choiceLines(m, 1, 'left')).toEqual(['L']);
    expect(choiceLines(m, 1, 'right')).toEqual(['R']);
    expect(choiceLines(m, 1, 'leftThenRight')).toEqual(['L', 'R']);
    expect(choiceLines(m, 1, 'rightThenLeft')).toEqual(['R', 'L']);
  });

  it('returns nothing for an out-of-range region', () => {
    expect(regionLines(m, 99, 'left')).toEqual([]);
    expect(defaultRegionLines(m, 99)).toEqual([]);
  });
});

describe('conflict markers', () => {
  it('detects any marker line but ignores ordinary text', () => {
    expect(hasConflictMarkers(conflictMarkerLines(['x'], ['y']))).toBe(true);
    expect(hasConflictMarkers(['<<<<<<< left'])).toBe(true);
    expect(hasConflictMarkers(['=======', 'x'])).toBe(true);
    expect(hasConflictMarkers(['>>>>>>> right'])).toBe(true);
    expect(hasConflictMarkers(['a', 'b', '== not a marker'])).toBe(false);
    expect(hasConflictMarkers([])).toBe(false);
  });
});

describe('stepRegion', () => {
  const region = (kind: MergeRegion['kind']): MergeRegion => ({
    kind,
    baseStart: 0,
    baseEnd: 0,
    leftStart: 0,
    leftEnd: 0,
    rightStart: 0,
    rightEnd: 0,
  });
  const regions = [
    region('stable'),
    region('left'),
    region('stable'),
    region('conflict'),
    region('right'),
  ];

  it('steps over stable regions and wraps around', () => {
    expect(stepRegion(regions, -1, 1)).toBe(1);
    expect(stepRegion(regions, 1, 1)).toBe(3);
    expect(stepRegion(regions, 4, 1)).toBe(1);
    expect(stepRegion(regions, -1, -1)).toBe(4);
    expect(stepRegion(regions, 1, -1)).toBe(4);
    expect(stepRegion(regions, 3, -1)).toBe(1);
  });

  it('can target conflicts only', () => {
    expect(stepRegion(regions, -1, 1, 'conflicts')).toBe(3);
    expect(stepRegion(regions, 3, 1, 'conflicts')).toBe(3);
    expect(stepRegion(regions, 3, -1, 'conflicts')).toBe(3);
  });

  it('returns -1 when nothing matches', () => {
    expect(stepRegion([], 0, 1)).toBe(-1);
    expect(stepRegion([region('stable')], -1, 1)).toBe(-1);
    expect(stepRegion([region('left')], -1, 1, 'conflicts')).toBe(-1);
  });
});

describe('splitLines / joinLines / mergeTexts', () => {
  it('splits LF, CRLF and CR text and notes the final newline', () => {
    expect(splitLines('a\nb\n')).toEqual({ lines: ['a', 'b'], eol: '\n', finalNewline: true });
    expect(splitLines('a\r\nb')).toEqual({ lines: ['a', 'b'], eol: '\r\n', finalNewline: false });
    expect(splitLines('a\rb').lines).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual({ lines: [], eol: '\n', finalNewline: false });
    expect(splitLines('\n').lines).toEqual(['']);
  });

  it('joins lines back with the chosen EOL', () => {
    expect(joinLines(['a', 'b'], '\r\n', true)).toBe('a\r\nb\r\n');
    expect(joinLines(['a', 'b'], '\n', false)).toBe('a\nb');
    expect(joinLines([], '\n', true)).toBe('');
  });

  it('merges texts ignoring EOL-only differences', () => {
    const { merge, eol, finalNewline } = mergeTexts('a\nb\n', 'a\r\nb\r\nc\r\n', 'a\nb\n');
    expect(kinds(merge)).toEqual(['stable', 'left']);
    expect(eol).toBe('\r\n');
    expect(finalNewline).toBe(true);
  });

  it('defaults to LF and no final newline when no input has them', () => {
    const { eol, finalNewline } = mergeTexts('a', 'a', 'a');
    expect(eol).toBe('\n');
    expect(finalNewline).toBe(false);
  });
});
