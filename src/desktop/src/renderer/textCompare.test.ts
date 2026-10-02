import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TEXT_COMPARE_OPTIONS,
  MAX_IGNORE_PATTERNS,
  classifyHunks,
  compileIgnorePatterns,
  hasSoftIgnores,
  hunkIndexAtLine,
  hunkRevealLine,
  ignoredSpans,
  importantIndices,
  importantPosition,
  normalizeLines,
  parsePatternText,
  resolveBaseIndex,
  sanitizeTextCompareOptions,
  stepHunk,
  summarizeHunks,
  type ClassifiedHunk,
  type DiffHunk,
  type TextCompareOptions,
} from './textCompare.js';

const opts = (over: Partial<TextCompareOptions> = {}): TextCompareOptions => ({
  ...DEFAULT_TEXT_COMPARE_OPTIONS,
  ignorePatterns: [],
  ...over,
});

const hunk = (o: [number, number], m: [number, number]): DiffHunk => ({
  originalStartLineNumber: o[0],
  originalEndLineNumber: o[1],
  modifiedStartLineNumber: m[0],
  modifiedEndLineNumber: m[1],
});

function readerFor(left: string[], right: string[]) {
  return (side: 'original' | 'modified', start: number, end: number): string =>
    (side === 'original' ? left : right).slice(start - 1, end).join('\n');
}

describe('sanitizeTextCompareOptions', () => {
  it('returns defaults for non-objects', () => {
    expect(sanitizeTextCompareOptions(null)).toEqual(DEFAULT_TEXT_COMPARE_OPTIONS);
    expect(sanitizeTextCompareOptions('x')).toEqual(DEFAULT_TEXT_COMPARE_OPTIONS);
  });

  it('keeps valid fields and falls back per-field for invalid ones', () => {
    const out = sanitizeTextCompareOptions({
      ignoreCase: true,
      ignoreTrimWhitespace: 'yes',
      wordWrap: true,
      ignorePatterns: ['a', '', 7, 'b'],
    });
    expect(out.ignoreCase).toBe(true);
    expect(out.ignoreTrimWhitespace).toBe(DEFAULT_TEXT_COMPARE_OPTIONS.ignoreTrimWhitespace);
    expect(out.wordWrap).toBe(true);
    expect(out.ignorePatterns).toEqual(['a', 'b']);
  });

  it('caps the number of patterns and never aliases the default array', () => {
    const many = Array.from({ length: MAX_IGNORE_PATTERNS + 5 }, (_, i) => `p${i}`);
    expect(sanitizeTextCompareOptions({ ignorePatterns: many }).ignorePatterns).toHaveLength(
      MAX_IGNORE_PATTERNS,
    );
    const a = sanitizeTextCompareOptions(undefined);
    a.ignorePatterns.push('x');
    expect(DEFAULT_TEXT_COMPARE_OPTIONS.ignorePatterns).toEqual([]);
  });
});

describe('patterns', () => {
  it('compiles valid patterns and reports invalid ones', () => {
    const { regexes, errors } = compileIgnorePatterns(['\\d+', '(', '']);
    expect(regexes).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.pattern).toBe('(');
    expect(errors[0]?.message).toBeTruthy();
  });

  it('parses the textarea into trimmed non-empty lines', () => {
    expect(parsePatternText(' a \r\n\n b\n')).toEqual(['a', 'b']);
    const big = Array.from({ length: 50 }, (_, i) => `p${i}`).join('\n');
    expect(parsePatternText(big)).toHaveLength(MAX_IGNORE_PATTERNS);
  });

  it('detects soft ignores', () => {
    expect(hasSoftIgnores(opts())).toBe(false);
    expect(hasSoftIgnores(opts({ ignoreCase: true }))).toBe(true);
    expect(hasSoftIgnores(opts({ ignoreAllWhitespace: true }))).toBe(true);
    expect(hasSoftIgnores(opts({ ignorePatterns: ['x'] }))).toBe(true);
  });
});

describe('normalizeLines', () => {
  const base = { ignoreAllWhitespace: false, ignoreCase: false };

  it('folds case and whitespace', () => {
    expect(
      normalizeLines(['Foo  Bar'], { ignoreAllWhitespace: true, ignoreCase: true }, []),
    ).toEqual(['foobar']);
  });

  it('removes regex matches, and is safe to reuse a global regex', () => {
    const re = /\d+/g;
    expect(normalizeLines(['a1', 'b22'], base, [re])).toEqual(['a', 'b']);
    expect(normalizeLines(['a1', 'b22'], base, [re])).toEqual(['a', 'b']);
  });

  it('drops lines fully consumed by a pattern but keeps genuinely blank lines', () => {
    const re = /\/\/.*/g;
    expect(normalizeLines(['x', '// note', '', 'y'], base, [re])).toEqual(['x', '', 'y']);
  });
});

describe('classifyHunks', () => {
  it('never reads text when no soft ignore is active', () => {
    const read = vi.fn(() => '');
    const hunks = classifyHunks([hunk([1, 1], [1, 1])], read, opts(), []);
    expect(hunks).toEqual([{ change: hunk([1, 1], [1, 1]), ignored: false }]);
    expect(read).not.toHaveBeenCalled();
  });

  it('returns [] for null changes', () => {
    expect(classifyHunks(null, () => '', opts(), [])).toEqual([]);
    expect(classifyHunks(undefined, () => '', opts(), [])).toEqual([]);
  });

  it('ignores case-only differences', () => {
    const read = readerFor(['Hello'], ['HELLO']);
    const [h] = classifyHunks([hunk([1, 1], [1, 1])], read, opts({ ignoreCase: true }), []);
    expect(h?.ignored).toBe(true);
    const [strict] = classifyHunks(
      [hunk([1, 1], [1, 1])],
      read,
      opts({ ignoreAllWhitespace: true }),
      [],
    );
    expect(strict?.ignored).toBe(false);
  });

  it('ignores whitespace-only differences, including internal whitespace', () => {
    const read = readerFor(['a b'], ['a    b']);
    const [h] = classifyHunks(
      [hunk([1, 1], [1, 1])],
      read,
      opts({ ignoreAllWhitespace: true }),
      [],
    );
    expect(h?.ignored).toBe(true);
  });

  it('keeps hunks with real changes important', () => {
    const read = readerFor(['abc'], ['abd']);
    const [h] = classifyHunks([hunk([1, 1], [1, 1])], read, opts({ ignoreCase: true }), []);
    expect(h?.ignored).toBe(false);
  });

  it('treats a pure insertion as important unless every inserted line is consumed by a pattern', () => {
    const { regexes } = compileIgnorePatterns(['^\\s*//.*$']);
    const read = readerFor(['a'], ['a', '// c1', '// c2']);
    const insertion = hunk([1, 0], [2, 3]);
    const [ignored] = classifyHunks([insertion], read, opts({ ignorePatterns: ['x'] }), regexes);
    expect(ignored?.ignored).toBe(true);

    const read2 = readerFor(['a'], ['a', '// c1', 'code']);
    const [important] = classifyHunks(
      [hunk([1, 0], [2, 3])],
      read2,
      opts({ ignorePatterns: ['x'] }),
      regexes,
    );
    expect(important?.ignored).toBe(false);
  });

  it('does not ignore a blank-line insertion by line-count mismatch', () => {
    const read = readerFor(['a'], ['a', '']);
    const [h] = classifyHunks(
      [hunk([1, 0], [2, 2])],
      read,
      opts({ ignoreAllWhitespace: true }),
      [],
    );
    expect(h?.ignored).toBe(false);
  });

  it('supports ignoring regex-defined text such as timestamps', () => {
    const { regexes } = compileIgnorePatterns(['\\d{4}-\\d{2}-\\d{2}']);
    const read = readerFor(['built 2024-01-01 ok'], ['built 2025-06-30 ok']);
    const [h] = classifyHunks(
      [hunk([1, 1], [1, 1])],
      read,
      opts({ ignorePatterns: ['x'] }),
      regexes,
    );
    expect(h?.ignored).toBe(true);
  });
});

describe('navigation helpers', () => {
  const mk = (ignored: boolean[]): ClassifiedHunk[] =>
    ignored.map((ig, i) => ({
      change: hunk([i * 10 + 1, i * 10 + 1], [i * 10 + 1, i * 10 + 1]),
      ignored: ig,
    }));

  it('lists important indices and positions', () => {
    const hs = mk([false, true, false]);
    expect(importantIndices(hs)).toEqual([0, 2]);
    expect(importantPosition(hs, 2)).toBe(2);
    expect(importantPosition(hs, 1)).toBe(0);
    expect(importantPosition(hs, -1)).toBe(0);
  });

  it('steps forward / backward, skipping ignored hunks and wrapping', () => {
    const hs = mk([false, true, false]);
    expect(stepHunk(hs, -1, 'next')).toBe(0);
    expect(stepHunk(hs, 0, 'next')).toBe(2);
    expect(stepHunk(hs, 2, 'next')).toBe(0);
    expect(stepHunk(hs, -1, 'previous')).toBe(2);
    expect(stepHunk(hs, 2, 'previous')).toBe(0);
    expect(stepHunk(hs, 0, 'previous')).toBe(2);
  });

  it('returns -1 when every hunk is ignored or there are none', () => {
    expect(stepHunk(mk([true, true]), -1, 'next')).toBe(-1);
    expect(stepHunk([], -1, 'previous')).toBe(-1);
  });

  it('maps a caret line to the hunk at or before it', () => {
    const hs = mk([false, false, false]); // reveal lines 1, 11, 21
    expect(hunkIndexAtLine(hs, 0)).toBe(-1);
    expect(hunkIndexAtLine(hs, 11)).toBe(1);
    expect(hunkIndexAtLine(hs, 500)).toBe(2);
  });

  it('resolves the base index from the caret', () => {
    const hs = mk([false, false, false]); // reveal lines 1, 11, 21
    expect(resolveBaseIndex(hs, -1, null)).toBe(-1);
    expect(resolveBaseIndex(hs, 1, null)).toBe(1);
    // default caret at 1:1 never moved → keep current
    expect(resolveBaseIndex(hs, -1, { lineNumber: 1, column: 1 })).toBe(-1);
    // caret still on the hunk we jumped to
    expect(resolveBaseIndex(hs, 1, { lineNumber: 11, column: 1 })).toBe(1);
    // user clicked elsewhere → nearest hunk at or before the caret
    expect(resolveBaseIndex(hs, 0, { lineNumber: 25, column: 4 })).toBe(2);
    expect(resolveBaseIndex(hs, 5, { lineNumber: 12, column: 1 })).toBe(1);
  });

  it('reveals line 1 for a deletion at the very top', () => {
    expect(hunkRevealLine(hunk([1, 2], [0, 0]))).toBe(1);
    expect(hunkRevealLine(hunk([1, 2], [7, 8]))).toBe(7);
  });

  it('computes ignored spans per side and skips zero-length sides', () => {
    const hs: ClassifiedHunk[] = [
      { change: hunk([2, 3], [2, 3]), ignored: true },
      { change: hunk([5, 5], [5, 5]), ignored: false },
      { change: hunk([8, 0], [9, 10]), ignored: true },
    ];
    expect(ignoredSpans(hs, 'original')).toEqual([{ start: 2, end: 3 }]);
    expect(ignoredSpans(hs, 'modified')).toEqual([
      { start: 2, end: 3 },
      { start: 9, end: 10 },
    ]);
  });

  it('summarises counts', () => {
    expect(summarizeHunks(mk([false, true, true]))).toEqual({ important: 1, ignored: 2 });
  });
});
