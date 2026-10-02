import { describe, expect, it } from 'vitest';
import type { MergeRegion } from '@awapi/shared';

import {
  finalizeResultText,
  regionClassName,
  regionSlot,
  slotAfterEdit,
  slotDecorationRange,
  slotEdit,
  slotIndexAtLine,
  slotLineCount,
  toLineSlot,
} from './mergeEditing.js';

const region: MergeRegion = {
  kind: 'conflict',
  baseStart: 1,
  baseEnd: 3,
  leftStart: 2,
  leftEnd: 2,
  rightStart: 0,
  rightEnd: 4,
};

describe('regionSlot', () => {
  it('converts 0-based half-open ranges to 1-based inclusive slots', () => {
    expect(regionSlot(region, 'base')).toEqual({ startLine: 2, endLine: 3 });
    expect(regionSlot(region, 'right')).toEqual({ startLine: 1, endLine: 4 });
    const left = regionSlot(region, 'left');
    expect(left).toEqual({ startLine: 3, endLine: 2 });
    expect(slotLineCount(left)).toBe(0);
  });
});

describe('toLineSlot', () => {
  const r = (a: number, b: number, c: number, d: number) => ({
    startLineNumber: a,
    startColumn: b,
    endLineNumber: c,
    endColumn: d,
  });

  it('keeps a multi-line range as is', () => {
    expect(toLineSlot(r(2, 1, 4, 9))).toEqual({ startLine: 2, endLine: 4 });
    expect(toLineSlot(r(2, 1, 2, 5))).toEqual({ startLine: 2, endLine: 2 });
  });

  it('drops a trailing line the range only touches at column 1', () => {
    expect(toLineSlot(r(2, 1, 5, 1))).toEqual({ startLine: 2, endLine: 4 });
  });

  it('turns an empty range into an empty slot at a line boundary', () => {
    expect(toLineSlot(r(3, 1, 3, 1))).toEqual({ startLine: 3, endLine: 2 });
    expect(toLineSlot(r(3, 6, 3, 6))).toEqual({ startLine: 4, endLine: 3 });
  });
});

describe('slotEdit', () => {
  it('replaces whole lines, terminating each with a newline', () => {
    expect(slotEdit({ startLine: 2, endLine: 3 }, ['x', 'y'])).toEqual({
      range: { startLineNumber: 2, startColumn: 1, endLineNumber: 4, endColumn: 1 },
      text: 'x\ny\n',
    });
  });

  it('inserts into an empty slot and deletes with no lines', () => {
    expect(slotEdit({ startLine: 5, endLine: 4 }, ['z'])).toEqual({
      range: { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 1 },
      text: 'z\n',
    });
    expect(slotEdit({ startLine: 1, endLine: 2 }, []).text).toBe('');
  });
});

describe('slotAfterEdit / slotDecorationRange / slotIndexAtLine', () => {
  it('computes the slot after an edit', () => {
    expect(slotAfterEdit({ startLine: 4, endLine: 6 }, 2)).toEqual({ startLine: 4, endLine: 5 });
    expect(slotAfterEdit({ startLine: 4, endLine: 6 }, 0)).toEqual({ startLine: 4, endLine: 3 });
  });

  it('builds decoration ranges', () => {
    expect(slotDecorationRange({ startLine: 2, endLine: 3 }, () => 7)).toEqual({
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 3,
      endColumn: 7,
    });
    expect(slotDecorationRange({ startLine: 2, endLine: 1 }, () => 7)).toEqual({
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 1,
    });
  });

  it('finds the slot containing a line', () => {
    const slots = [
      null,
      { startLine: 1, endLine: 2 },
      { startLine: 3, endLine: 2 },
      { startLine: 5, endLine: 6 },
    ];
    expect(slotIndexAtLine(slots, 2)).toBe(1);
    expect(slotIndexAtLine(slots, 3)).toBe(-1);
    expect(slotIndexAtLine(slots, 6)).toBe(3);
  });
});

describe('regionClassName', () => {
  it('maps kinds and states to classes', () => {
    expect(regionClassName('left')).toBe('awapi-merge__region awapi-merge__region--left');
    expect(regionClassName('both', { current: true })).toBe(
      'awapi-merge__region awapi-merge__region--both awapi-merge__region--current',
    );
    expect(regionClassName('conflict', { unresolved: true })).toContain('--conflict');
    expect(regionClassName('conflict')).toContain('--conflict');
    expect(regionClassName('conflict', { unresolved: false })).toContain('--resolved');
  });
});

describe('finalizeResultText', () => {
  it('re-applies EOL style and final newline', () => {
    expect(finalizeResultText('a\nb\n', '\r\n', true)).toBe('a\r\nb\r\n');
    expect(finalizeResultText('a\nb\n', '\n', false)).toBe('a\nb');
    expect(finalizeResultText('', '\n', true)).toBe('');
  });
});
