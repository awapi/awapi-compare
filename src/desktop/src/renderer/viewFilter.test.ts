import { describe, expect, it } from 'vitest';
import type { ComparedPair, DiffStatus, FsEntry } from '@awapi/shared';
import {
  filterPairs,
  filterTextLines,
  isFolderOnlyFilter,
  MAX_FILTERABLE_LINES,
} from './viewFilter.js';

function entry(relPath: string, type: 'file' | 'dir' = 'file'): FsEntry {
  const segs = relPath.split('/');
  return {
    relPath,
    name: segs[segs.length - 1] ?? relPath,
    type,
    size: 0,
    mtimeMs: 0,
    mode: 0o644,
  };
}

function pair(relPath: string, status: DiffStatus, type: 'file' | 'dir' = 'file'): ComparedPair {
  return {
    relPath,
    left: entry(relPath, type),
    right: entry(relPath, type),
    status,
  };
}

describe('folder-only filters', () => {
  const pairs: ComparedPair[] = [
    pair('a.txt', 'identical'),
    pair('b.txt', 'different'),
    pair('c.txt', 'newer-left'),
    pair('d.txt', 'newer-right'),
    pair('e.txt', 'left-only'),
    pair('f.txt', 'right-only'),
    pair('g.txt', 'error'),
  ];

  it('"different" keeps different and newer entries but not orphans', () => {
    expect(filterPairs(pairs, 'different').map((p) => p.relPath)).toEqual([
      'b.txt',
      'c.txt',
      'd.txt',
    ]);
  });

  it('"newer" keeps only newer-left / newer-right entries', () => {
    expect(filterPairs(pairs, 'newer').map((p) => p.relPath)).toEqual(['c.txt', 'd.txt']);
  });

  it('"orphans" keeps one-sided entries and orphan folders', () => {
    const input = [...pairs, pair('only', 'left-only', 'dir')];
    expect(filterPairs(input, 'orphans').map((p) => p.relPath)).toEqual([
      'e.txt',
      'f.txt',
      'only',
    ]);
  });

  it('keeps ancestor directories of surviving entries', () => {
    const input = [
      pair('src', 'identical', 'dir'),
      pair('src/x.ts', 'newer-left'),
      pair('docs', 'identical', 'dir'),
      pair('docs/y.md', 'identical'),
    ];
    expect(filterPairs(input, 'newer').map((p) => p.relPath)).toEqual(['src', 'src/x.ts']);
  });

  it('"selected" keeps selected rows, descendants of selected dirs and ancestors', () => {
    const input = [
      pair('src', 'identical', 'dir'),
      pair('src/x.ts', 'identical'),
      pair('src/deep', 'identical', 'dir'),
      pair('src/deep/z.ts', 'different'),
      pair('other', 'identical', 'dir'),
      pair('other/a.ts', 'identical'),
      pair('top.txt', 'identical'),
    ];
    expect(
      filterPairs(input, 'selected', new Set(['src/deep', 'other/a.ts'])).map((p) => p.relPath),
    ).toEqual(['src', 'src/deep', 'src/deep/z.ts', 'other', 'other/a.ts']);
  });

  it('"selected" with no selection keeps nothing', () => {
    expect(filterPairs(pairs, 'selected')).toEqual([]);
  });

  it('isFolderOnlyFilter distinguishes content filters from folder filters', () => {
    expect(isFolderOnlyFilter('orphans')).toBe(true);
    expect(isFolderOnlyFilter('selected')).toBe(true);
    expect(isFolderOnlyFilter('all')).toBe(false);
    expect(isFolderOnlyFilter('diffs')).toBe(false);
  });
});

describe('filterPairs', () => {
  it('returns the input unchanged in "all" mode', () => {
    const input: ComparedPair[] = [pair('a.txt', 'identical'), pair('b.txt', 'different')];
    const result = filterPairs(input, 'all');
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it('keeps only differing files in "diffs" mode', () => {
    const pairs: ComparedPair[] = [
      pair('a.txt', 'identical'),
      pair('b.txt', 'different'),
      pair('c.txt', 'left-only'),
    ];
    const result = filterPairs(pairs, 'diffs');
    expect(result.map((p) => p.relPath)).toEqual(['b.txt', 'c.txt']);
  });

  it('keeps only identical files in "same" mode', () => {
    const pairs: ComparedPair[] = [
      pair('a.txt', 'identical'),
      pair('b.txt', 'different'),
      pair('c.txt', 'excluded'),
    ];
    const result = filterPairs(pairs, 'same');
    expect(result.map((p) => p.relPath).sort()).toEqual(['a.txt', 'c.txt']);
  });

  it('re-includes ancestor directory pairs when filtering diffs', () => {
    const pairs: ComparedPair[] = [
      pair('src', 'identical', 'dir'),
      pair('src/a.ts', 'identical'),
      pair('src/b.ts', 'different'),
      pair('top.txt', 'identical'),
    ];
    const result = filterPairs(pairs, 'diffs');
    expect(result.map((p) => p.relPath).sort()).toEqual(['src', 'src/b.ts']);
  });

  it('keeps a left-only directory pair in diffs mode', () => {
    const pairs: ComparedPair[] = [
      pair('only-left', 'left-only', 'dir'),
      pair('keep.txt', 'identical'),
    ];
    const result = filterPairs(pairs, 'diffs');
    expect(result.map((p) => p.relPath)).toEqual(['only-left']);
  });

  it('re-includes ancestor directory pairs when filtering same', () => {
    const pairs: ComparedPair[] = [
      pair('src', 'identical', 'dir'),
      pair('src/a.ts', 'identical'),
      pair('src/b.ts', 'different'),
    ];
    const result = filterPairs(pairs, 'same');
    expect(result.map((p) => p.relPath).sort()).toEqual(['src', 'src/a.ts']);
  });

  it('handles deeply nested ancestors', () => {
    const pairs: ComparedPair[] = [
      pair('a', 'identical', 'dir'),
      pair('a/b', 'identical', 'dir'),
      pair('a/b/c.txt', 'different'),
    ];
    const result = filterPairs(pairs, 'diffs');
    expect(result.map((p) => p.relPath)).toEqual(['a', 'a/b', 'a/b/c.txt']);
  });
});

describe('filterTextLines', () => {
  it('passes the input through unchanged in "all" mode', () => {
    const r = filterTextLines('a\nb', 'a\nc', 'all');
    expect(r).toEqual({ leftText: 'a\nb', rightText: 'a\nc', applied: false });
  });

  it('keeps only differing lines in "diffs" mode', () => {
    const r = filterTextLines('a\nb\nc', 'a\nx\nc', 'diffs');
    expect(r.applied).toBe(true);
    expect(r.leftText).toBe('b');
    expect(r.rightText).toBe('x');
  });

  it('keeps only matching lines in "same" mode', () => {
    const r = filterTextLines('a\nb\nc', 'a\nx\nc', 'same');
    expect(r.applied).toBe(true);
    expect(r.leftText).toBe('a\nc');
    expect(r.rightText).toBe('a\nc');
  });

  it('treats null sides as empty', () => {
    const r = filterTextLines(null, 'x\ny', 'diffs');
    expect(r.applied).toBe(true);
    expect(r.leftText).toBe('');
    expect(r.rightText).toBe('x\ny');
  });

  it('handles CRLF line endings', () => {
    const r = filterTextLines('a\r\nb', 'a\r\nc', 'diffs');
    expect(r.leftText).toBe('b');
    expect(r.rightText).toBe('c');
  });

  it('falls back to all-pass when either side exceeds MAX_FILTERABLE_LINES', () => {
    const big = Array.from({ length: MAX_FILTERABLE_LINES + 1 }, (_v, i) => `l${i}`).join('\n');
    const r = filterTextLines(big, 'a', 'diffs');
    expect(r.applied).toBe(false);
    expect(r.leftText).toBe(big);
    expect(r.rightText).toBe('a');
  });
});
