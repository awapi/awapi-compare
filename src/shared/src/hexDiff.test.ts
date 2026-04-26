import { describe, expect, it } from 'vitest';
import {
  HEX_DIFF_BLOCK_SIZE,
  asciiGlyph,
  diffHex,
  formatHexByte,
  formatHexOffset,
  rowSlice,
} from './hexDiff.js';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function repeated(byte: number, count: number): Uint8Array {
  return Uint8Array.from({ length: count }, () => byte);
}

describe('diffHex', () => {
  it('reports identical buffers as one equal segment', () => {
    const a = repeated(0xab, 32);
    const result = diffHex(a, a);
    expect(result.identical).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.leftRows).toBe(2);
    expect(result.rightRows).toBe(2);
    expect(result.segments).toEqual([
      { kind: 'equal', leftOffset: 0, rightOffset: 0, rows: 2 },
    ]);
  });

  it('returns an empty diff for two empty buffers', () => {
    const result = diffHex(new Uint8Array(0), new Uint8Array(0));
    expect(result.identical).toBe(true);
    expect(result.leftRows).toBe(0);
    expect(result.rightRows).toBe(0);
    expect(result.segments).toEqual([]);
  });

  it('emits a pure-insert change when the right side adds rows', () => {
    const a = repeated(0x01, 16);
    const b = Uint8Array.from([...repeated(0x01, 16), ...repeated(0x02, 16)]);
    const r = diffHex(a, b);
    expect(r.identical).toBe(false);
    expect(r.segments).toEqual([
      { kind: 'equal', leftOffset: 0, rightOffset: 0, rows: 1 },
      { kind: 'change', leftRows: 0, rightRows: 1, rightOffset: 16 },
    ]);
  });

  it('emits a pure-delete change when the left side has extra rows', () => {
    const a = Uint8Array.from([...repeated(0x01, 16), ...repeated(0x02, 16)]);
    const b = repeated(0x01, 16);
    const r = diffHex(a, b);
    expect(r.segments).toEqual([
      { kind: 'equal', leftOffset: 0, rightOffset: 0, rows: 1 },
      { kind: 'change', leftRows: 1, rightRows: 0, leftOffset: 16 },
    ]);
  });

  it('emits a balanced change for one differing row in the middle', () => {
    const left = Uint8Array.from([
      ...repeated(0x01, 16),
      ...repeated(0x02, 16),
      ...repeated(0x03, 16),
    ]);
    const right = Uint8Array.from([
      ...repeated(0x01, 16),
      ...repeated(0xff, 16),
      ...repeated(0x03, 16),
    ]);
    const r = diffHex(left, right);
    expect(r.segments).toEqual([
      { kind: 'equal', leftOffset: 0, rightOffset: 0, rows: 1 },
      { kind: 'change', leftRows: 1, rightRows: 1, leftOffset: 16, rightOffset: 16 },
      { kind: 'equal', leftOffset: 32, rightOffset: 32, rows: 1 },
    ]);
  });

  it('honours a custom block size', () => {
    const r = diffHex(bytes(1, 2, 3, 4), bytes(1, 2, 9, 4), { blockSize: 2 });
    // Rows: [1,2] [3,4]  vs  [1,2] [9,4]
    expect(r.leftRows).toBe(2);
    expect(r.rightRows).toBe(2);
    expect(r.segments).toEqual([
      { kind: 'equal', leftOffset: 0, rightOffset: 0, rows: 1 },
      { kind: 'change', leftRows: 1, rightRows: 1, leftOffset: 2, rightOffset: 2 },
    ]);
  });

  it('rejects non-positive block sizes', () => {
    expect(() => diffHex(bytes(1), bytes(1), { blockSize: 0 })).toThrow(/blockSize/);
    expect(() => diffHex(bytes(1), bytes(1), { blockSize: -4 })).toThrow(/blockSize/);
    expect(() => diffHex(bytes(1), bytes(1), { blockSize: 1.5 })).toThrow(/blockSize/);
  });

  it('treats the trailing partial row distinctly from a full row', () => {
    // Same first 16 bytes; left has 4-byte tail, right has 8-byte tail.
    const head = repeated(0xa, 16);
    const left = Uint8Array.from([...head, 1, 2, 3, 4]);
    const right = Uint8Array.from([...head, 1, 2, 3, 4, 5, 6, 7, 8]);
    const r = diffHex(left, right);
    expect(r.segments[0]).toEqual({
      kind: 'equal',
      leftOffset: 0,
      rightOffset: 0,
      rows: 1,
    });
    // The tails differ in length so they're not equal blocks.
    expect(r.segments[1]?.kind).toBe('change');
  });

  it('falls back to a single mega-segment when the input is too large', () => {
    // Force the truncation path with a tiny block size.
    const buf = repeated(0x77, 1024);
    const r = diffHex(buf, buf, { blockSize: 1 });
    // 1024 + 1024 = 2048 < default cap; this should NOT truncate.
    expect(r.truncated).toBe(false);

    const big = repeated(0x77, 1_048_576);
    const r2 = diffHex(big, big, { blockSize: 2 });
    expect(r2.truncated).toBe(true);
    expect(r2.identical).toBe(true);
    expect(r2.segments).toHaveLength(1);
    expect(r2.segments[0]?.kind).toBe('equal');
  });

  it('reports a single change segment when the truncated path is hit on different inputs', () => {
    const a = repeated(0xaa, 1_048_576);
    const b = repeated(0xbb, 1_048_576);
    const r = diffHex(a, b, { blockSize: 2 });
    expect(r.truncated).toBe(true);
    expect(r.identical).toBe(false);
    expect(r.segments).toEqual([
      {
        kind: 'change',
        leftRows: r.leftRows,
        rightRows: r.rightRows,
        leftOffset: 0,
        rightOffset: 0,
      },
    ]);
  });
});

describe('rowSlice', () => {
  it('returns the requested 16-byte window', () => {
    const buf = Uint8Array.from({ length: 40 }, (_, i) => i);
    expect(Array.from(rowSlice(buf, 0))).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(Array.from(rowSlice(buf, 1))).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 16),
    );
    // Last partial row.
    expect(Array.from(rowSlice(buf, 2))).toEqual([32, 33, 34, 35, 36, 37, 38, 39]);
  });

  it('returns an empty slice when the row is past the end', () => {
    expect(rowSlice(new Uint8Array(8), 1)).toHaveLength(0);
    expect(rowSlice(new Uint8Array(8), -1)).toHaveLength(0);
  });

  it('honours a custom block size', () => {
    const buf = bytes(1, 2, 3, 4, 5, 6);
    expect(Array.from(rowSlice(buf, 1, 2))).toEqual([3, 4]);
  });
});

describe('formatHexByte', () => {
  it('formats single bytes as two uppercase hex chars', () => {
    expect(formatHexByte(0)).toBe('00');
    expect(formatHexByte(15)).toBe('0F');
    expect(formatHexByte(255)).toBe('FF');
  });

  it('masks values to a single byte', () => {
    expect(formatHexByte(0x1ab)).toBe('AB');
  });
});

describe('formatHexOffset', () => {
  it('formats offsets as eight uppercase hex chars', () => {
    expect(formatHexOffset(0)).toBe('00000000');
    expect(formatHexOffset(0x10)).toBe('00000010');
    expect(formatHexOffset(0xdeadbeef)).toBe('DEADBEEF');
  });
});

describe('asciiGlyph', () => {
  it('returns the printable ASCII glyph for 0x20..0x7e', () => {
    expect(asciiGlyph(0x41)).toBe('A');
    expect(asciiGlyph(0x20)).toBe(' ');
    expect(asciiGlyph(0x7e)).toBe('~');
  });

  it('returns "." for control / non-ASCII bytes', () => {
    expect(asciiGlyph(0x00)).toBe('.');
    expect(asciiGlyph(0x1f)).toBe('.');
    expect(asciiGlyph(0x7f)).toBe('.');
    expect(asciiGlyph(0xff)).toBe('.');
  });
});

describe('HEX_DIFF_BLOCK_SIZE', () => {
  it('defaults to 16 bytes per row', () => {
    expect(HEX_DIFF_BLOCK_SIZE).toBe(16);
  });
});
