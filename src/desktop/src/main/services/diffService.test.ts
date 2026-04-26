import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DIFF_OPTIONS,
  diffOptionsFromMode,
  mergeDiffOptions,
  type FsEntry,
} from '@awapi/shared';

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

/** Force the engine into "always read content" mode for tests that
 *  exercise the hash-comparison branches. */
const ALWAYS_HASH = mergeDiffOptions({
  content: { skipWhenAttributesMatch: false },
});

describe('classifyPair — invariants', () => {
  it('throws when both sides are undefined', () => {
    expect(() => classifyPair(undefined, undefined, 'quick')).toThrow(/both sides/);
  });

  it('returns left-only / right-only when one side is missing', () => {
    expect(classifyPair(file(), undefined, 'quick')).toBe('left-only');
    expect(classifyPair(undefined, file(), 'quick')).toBe('right-only');
  });

  it('returns different for type mismatch (file vs dir)', () => {
    expect(
      classifyPair(file(), dir({ relPath: 'a.txt', name: 'a.txt' }), 'quick'),
    ).toBe('different');
  });

  it('returns identical when both sides are directories', () => {
    expect(classifyPair(dir(), dir(), 'thorough')).toBe('identical');
  });
});

describe('classifyPair — quick mode (content: off)', () => {
  it('size differs → newer-left / newer-right by mtime', () => {
    expect(
      classifyPair(file({ size: 20, mtimeMs: 5000 }), file({ size: 10, mtimeMs: 1000 }), 'quick'),
    ).toBe('newer-left');
    expect(
      classifyPair(file({ size: 10, mtimeMs: 1000 }), file({ size: 20, mtimeMs: 5000 }), 'quick'),
    ).toBe('newer-right');
  });

  it('size differs but mtimes equal → different', () => {
    expect(classifyPair(file({ size: 10 }), file({ size: 20 }), 'quick')).toBe('different');
  });

  it('same size + mtimes within epsilon → identical', () => {
    expect(
      classifyPair(file({ mtimeMs: 1000 }), file({ mtimeMs: 1000 + MTIME_EPSILON_MS }), 'quick'),
    ).toBe('identical');
  });

  it('same size + mtime skew beyond epsilon → newer-left / newer-right', () => {
    expect(classifyPair(file({ mtimeMs: 10_000 }), file({ mtimeMs: 1_000 }), 'quick')).toBe(
      'newer-left',
    );
    expect(classifyPair(file({ mtimeMs: 1_000 }), file({ mtimeMs: 10_000 }), 'quick')).toBe(
      'newer-right',
    );
  });

  it('respects a custom epsilon (legacy mtimeEpsilonMs)', () => {
    expect(
      classifyPair(file({ mtimeMs: 1_000 }), file({ mtimeMs: 1_500 }), 'quick', undefined, {
        mtimeEpsilonMs: 100,
      }),
    ).toBe('newer-right');
  });
});

describe('classifyPair — thorough / binary mode', () => {
  it('skips content read when attributes already match (default)', () => {
    // Same size + same mtime ⇒ skipWhenAttributesMatch:true short-circuits.
    expect(classifyPair(file(), file(), 'thorough')).toBe('identical');
    expect(classifyPair(file(), file(), 'binary')).toBe('identical');
  });

  it('throws if hashes are missing when content actually has to be read', () => {
    // Force-disable the skip optimisation to exercise the hash branch.
    expect(() =>
      classifyPair(file(), file(), 'thorough', undefined, { diffOptions: ALWAYS_HASH }),
    ).toThrow(/hashes required/);
    expect(() =>
      classifyPair(file(), file(), 'binary', { left: 'a' }, { diffOptions: ALWAYS_HASH }),
    ).toThrow(/hashes required/);
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
    // Same mtime + same size + different hash → different (with default
    // overrideAttributesResult: true, content beats attributes).
    expect(
      classifyPair(file(), file(), 'thorough', { left: 'a', right: 'b' }, { diffOptions: ALWAYS_HASH }),
    ).toBe('different');
  });

  it('overrideAttributesResult:false keeps "identical" when attrs say so', () => {
    const opts = mergeDiffOptions({
      content: { skipWhenAttributesMatch: false, overrideAttributesResult: false },
    });
    // Same size + same mtime, but content differs — caller asked the
    // engine to honour the attribute verdict.
    expect(
      classifyPair(file(), file(), 'thorough', { left: 'a', right: 'b' }, { diffOptions: opts }),
    ).toBe('identical');
  });
});

describe('classifyPair — DiffOptions explicit', () => {
  it('attributes.size:false treats different sizes as equal', () => {
    const opts = mergeDiffOptions({ attributes: { size: false }, content: { mode: 'off' } });
    expect(
      classifyPair(file({ size: 100 }), file({ size: 200 }), 'quick', undefined, {
        diffOptions: opts,
      }),
    ).toBe('identical');
  });

  it('attributes.mtime.enabled:false ignores mtime skew', () => {
    const opts = mergeDiffOptions({
      attributes: { mtime: { enabled: false } },
      content: { mode: 'off' },
    });
    expect(
      classifyPair(file({ mtimeMs: 0 }), file({ mtimeMs: 9_999_999 }), 'quick', undefined, {
        diffOptions: opts,
      }),
    ).toBe('identical');
  });

  it('ignoreDstShift accepts a 1h skew as identical', () => {
    const opts = mergeDiffOptions({
      attributes: { mtime: { ignoreDstShift: true } },
      content: { mode: 'off' },
    });
    expect(
      classifyPair(file({ mtimeMs: 0 }), file({ mtimeMs: 60 * 60 * 1000 }), 'quick', undefined, {
        diffOptions: opts,
      }),
    ).toBe('identical');
  });

  it('explicit DiffOptions overrides legacy mtimeEpsilonMs', () => {
    const opts = mergeDiffOptions({
      attributes: { mtime: { toleranceSeconds: 0 } },
      content: { mode: 'off' },
    });
    expect(
      classifyPair(file({ mtimeMs: 0 }), file({ mtimeMs: 50 }), 'quick', undefined, {
        diffOptions: opts,
        mtimeEpsilonMs: 60_000, // ignored
      }),
    ).toBe('newer-right');
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

  it('forwards explicit DiffOptions to the classifier', () => {
    const svc = new DiffService();
    const opts = mergeDiffOptions({
      attributes: { size: false, mtime: { enabled: false } },
      content: { mode: 'off' },
    });
    const pair = svc.classify(file({ size: 1 }), file({ size: 999, mtimeMs: 9 }), 'binary', undefined, {
      diffOptions: opts,
    });
    expect(pair.status).toBe('identical');
  });
});

describe('diffOptionsFromMode round-trip', () => {
  it.each(['quick', 'thorough', 'binary'] as const)(
    'classifier with derived options matches the bare-mode call for %s',
    (mode) => {
      const left = file({ mtimeMs: 5_000 });
      const right = file({ mtimeMs: 5_000 });
      const a = classifyPair(left, right, mode);
      const b = classifyPair(left, right, mode, undefined, {
        diffOptions: diffOptionsFromMode(mode),
      });
      expect(a).toBe(b);
    },
  );

  it('DEFAULT_DIFF_OPTIONS yields identical for identical files', () => {
    expect(
      classifyPair(file(), file(), 'thorough', undefined, { diffOptions: DEFAULT_DIFF_OPTIONS }),
    ).toBe('identical');
  });
});
