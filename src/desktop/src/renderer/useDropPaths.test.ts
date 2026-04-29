import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractDroppedPaths, sideFromPointer } from './useDropPaths.js';

describe('sideFromPointer', () => {
  const rect = { left: 100, width: 400 }; // midpoint = 300

  it('returns "left" when pointer is in the left half', () => {
    expect(sideFromPointer(150, rect)).toBe('left');
    expect(sideFromPointer(299, rect)).toBe('left');
  });

  it('returns "right" when pointer is in the right half', () => {
    expect(sideFromPointer(300, rect)).toBe('right');
    expect(sideFromPointer(499, rect)).toBe('right');
  });

  it('returns "left" exactly at the left edge', () => {
    expect(sideFromPointer(100, rect)).toBe('left');
  });

  it('falls back to "left" for a zero-width rect', () => {
    expect(sideFromPointer(50, { left: 0, width: 0 })).toBe('left');
  });
});

describe('extractDroppedPaths', () => {
  const original = (globalThis as { awapi?: unknown }).awapi;
  afterEach(() => {
    (globalThis as { awapi?: unknown }).awapi = original;
  });

  function makeDataTransfer(files: File[]): DataTransfer {
    const list = {
      length: files.length,
      item: (i: number): File | null => files[i] ?? null,
    };
    return { files: list as unknown as FileList } as unknown as DataTransfer;
  }

  it('returns [] when no DataTransfer is provided', () => {
    expect(extractDroppedPaths(null)).toEqual([]);
  });

  it('returns [] when the awapi bridge is unavailable', () => {
    (globalThis as { awapi?: unknown }).awapi = undefined;
    const dt = makeDataTransfer([new File(['x'], 'a.txt')]);
    expect(extractDroppedPaths(dt)).toEqual([]);
  });

  it('resolves each File via getPathForFile and skips empty results', () => {
    const f1 = new File(['a'], 'a.txt');
    const f2 = new File(['b'], 'b.txt');
    const f3 = new File(['c'], 'c.txt');
    const getPathForFile = vi.fn((f: File) => {
      if (f === f1) return '/abs/a.txt';
      if (f === f2) return ''; // in-memory file: no disk path
      return '/abs/c.txt';
    });
    (globalThis as { awapi?: unknown }).awapi = { app: { getPathForFile } };
    const dt = makeDataTransfer([f1, f2, f3]);
    expect(extractDroppedPaths(dt)).toEqual(['/abs/a.txt', '/abs/c.txt']);
    expect(getPathForFile).toHaveBeenCalledTimes(3);
  });
});
