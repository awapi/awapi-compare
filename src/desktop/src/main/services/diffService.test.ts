import { describe, expect, it } from 'vitest';

import type { FsEntry } from '@awapi/shared';

import { classifyPair, DiffService, MTIME_EPSILON_MS } from './diffService.js';

function file(overrides: Partial<FsEntry> = {}): FsEntry {
  return {
    relPath: 'a.txt',
    name: 'a.txt',
    type: 'file',
    size: 10,
    mtimeMs: 1_000_000,
    mode: 0o644,
    ...overrides,
  };
}

function dir(overrides: Partial<FsEntry> = {}): FsEntry {
  return file({ type: 'dir', size: 0, name: 'd', relPath: 'd', ...overrides });
}

describe('classifyPair', () => {
  it('throws when both sides are undefined', () => {
    expect(() => classifyPair(undefined, undefined, 'quick')).toThrow(/both sides/);
  });

  it('returns left-only / right-only when one side is missing', () => {
    expect(classifyPair(file(), undefined, 'quick')).toBe('left-only');
    expect(classifyPair(undefined, file(), 'quick')).toBe('right-only');
  });

  it('returns different for type mismatch (file vs dir)', () => {
    expect(classifyPair(file(), dir({ relPath: 'a.txt', name: 'a.txt' }), 'quick')).toBe(
      'different',
    );
  });

  it('returns identical when both sides are directories', () => {
    expect(classifyPair(dir(), dir(), 'thorough')).toBe('identical');
  });

  describe('quick mode', () => {
    it('size differs → newer-left / newer-right by mtime', () => {
      expect(classifyPair(file({ size: 20, mtimeMs: 5000 }), file({ size: 10, mtimeMs: 1000 }), 'quick')).toBe(
        'newer-left',
      );
      expect(classifyPair(file({ size: 10, mtimeMs: 1000 }), file({ size: 20, mtimeMs: 5000 }), 'quick')).toBe(
        'newer-right',
      );
    });

    it('size differs but mtimes equal → different', () => {
      expect(classifyPair(file({ size: 10 }), file({ size: 20 }), 'quick')).toBe('different');
    });

    it('same size + mtimes within epsilon → identical', () => {
      expect(classifyPair(file({ mtimeMs: 1000 }), file({ mtimeMs: 1000 + MTIME_EPSILON_MS }), 'quick')).toBe(
        'identical',
      );
    });

    it('same size + mtime skew beyond epsilon → newer-left / newer-right', () => {
      expect(classifyPair(file({ mtimeMs: 10_000 }), file({ mtimeMs: 1_000 }), 'quick')).toBe('newer-left');
      expect(classifyPair(file({ mtimeMs: 1_000 }), file({ mtimeMs: 10_000 }), 'quick')).toBe('newer-right');
    });

    it('respects a custom epsilon', () => {
      expect(
        classifyPair(
          file({ mtimeMs: 1_000 }),
          file({ mtimeMs: 1_500 }),
          'quick',
          undefined,
          { mtimeEpsilonMs: 100 },
        ),
      ).toBe('newer-right');
    });
  });

  describe('thorough / binary mode', () => {
    it('throws if hashes are missing', () => {
      expect(() => classifyPair(file(), file(), 'thorough')).toThrow(/hashes required/);
      expect(() => classifyPair(file(), file(), 'binary', { left: 'a' })).toThrow(/hashes required/);
    });

    it('same hash → identical even if sizes/mtimes drift within', () => {
      expect(classifyPair(file(), file(), 'thorough', { left: 'h', right: 'h' })).toBe('identical');
    });

    it('different hash but size-equal → newer-left / newer-right / different', () => {
      expect(
        classifyPair(file({ mtimeMs: 10_000 }), file({ mtimeMs: 1_000 }), 'thorough', {
          left: 'a',
          right: 'b',
        }),
      ).toBe('newer-left');
      expect(
        classifyPair(file({ mtimeMs: 1_000 }), file({ mtimeMs: 10_000 }), 'binary', {
          left: 'a',
          right: 'b',
        }),
      ).toBe('newer-right');
      expect(
        classifyPair(file(), file(), 'thorough', { left: 'a', right: 'b' }),
      ).toBe('different');
    });
  });
});

describe('DiffService.classify', () => {
  it('returns a ComparedPair with relPath and metadata populated', () => {
    const svc = new DiffService();
    const left = file({ relPath: 'src/a.txt', name: 'a.txt' });
    const right = file({ relPath: 'src/a.txt', name: 'a.txt', mtimeMs: 10_000_000 });

    const pair = svc.classify(left, right, 'thorough', { left: 'h1', right: 'h2' });

    expect(pair.relPath).toBe('src/a.txt');
    expect(pair.status).toBe('newer-right');
    expect(pair.left).toBe(left);
    expect(pair.right).toBe(right);
    expect(pair.leftHash).toBe('h1');
    expect(pair.rightHash).toBe('h2');
  });

  it('uses right-side relPath when left is missing', () => {
    const svc = new DiffService();
    const right = file({ relPath: 'only/right.txt' });
    expect(svc.classify(undefined, right, 'quick').relPath).toBe('only/right.txt');
  });

  it('omits hash fields and left/right when not supplied', () => {
    const svc = new DiffService();
    const pair = svc.classify(file(), undefined, 'quick');
    expect(pair.status).toBe('left-only');
    expect(pair.leftHash).toBeUndefined();
    expect(pair.rightHash).toBeUndefined();
    expect(pair.right).toBeUndefined();
  });
});
