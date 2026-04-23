import { describe, expect, it } from 'vitest';

import type { FsEntry, Rule } from '@awapi/shared';

import { compileRules, evaluate, evaluateAll } from './ruleMatcher.js';

let nextId = 0;
function rule(partial: Partial<Rule>): Rule {
  return {
    id: `r${++nextId}`,
    kind: 'exclude',
    pattern: '**',
    enabled: true,
    ...partial,
  };
}

function entry(relPath: string, overrides: Partial<FsEntry> = {}): FsEntry {
  return {
    relPath,
    name: relPath.split('/').pop() ?? relPath,
    type: 'file',
    size: 100,
    mtimeMs: 1_000_000,
    mode: 0o644,
    ...overrides,
  };
}

describe('ruleMatcher — defaults & disabled rules', () => {
  it('keeps everything when no rules are configured', () => {
    expect(evaluate(compileRules([]), entry('a/b.txt'))).toBe('kept');
  });

  it('ignores disabled rules', () => {
    const rules = [rule({ kind: 'exclude', pattern: '**/*.log', enabled: false })];
    expect(evaluate(compileRules(rules), entry('build/out.log'))).toBe('kept');
  });

  it('a disabled include rule does not flip the engine into whitelist mode', () => {
    const rules = [rule({ kind: 'include', pattern: '**/*.ts', enabled: false })];
    // No active rules ⇒ default `kept`.
    expect(evaluate(compileRules(rules), entry('src/a.js'))).toBe('kept');
  });
});

describe('ruleMatcher — picomatch glob matrix', () => {
  it('`*` matches a single path segment', () => {
    const rules = [rule({ kind: 'exclude', pattern: '*.log' })];
    const c = compileRules(rules);
    expect(evaluate(c, entry('out.log'))).toBe('excluded');
    // `*` does NOT cross directory separators.
    expect(evaluate(c, entry('build/out.log'))).toBe('kept');
  });

  it('`**` matches across directory separators', () => {
    const rules = [rule({ kind: 'exclude', pattern: '**/*.log' })];
    const c = compileRules(rules);
    expect(evaluate(c, entry('out.log'))).toBe('excluded');
    expect(evaluate(c, entry('build/out.log'))).toBe('excluded');
    expect(evaluate(c, entry('build/sub/dir/out.log'))).toBe('excluded');
  });

  it('`?` matches exactly one character', () => {
    const rules = [rule({ kind: 'exclude', pattern: 'a?.txt' })];
    const c = compileRules(rules);
    expect(evaluate(c, entry('ab.txt'))).toBe('excluded');
    expect(evaluate(c, entry('a.txt'))).toBe('kept');
    expect(evaluate(c, entry('abc.txt'))).toBe('kept');
  });

  it('`[abc]` character classes', () => {
    const rules = [rule({ kind: 'exclude', pattern: 'file[12].txt' })];
    const c = compileRules(rules);
    expect(evaluate(c, entry('file1.txt'))).toBe('excluded');
    expect(evaluate(c, entry('file2.txt'))).toBe('excluded');
    expect(evaluate(c, entry('file3.txt'))).toBe('kept');
  });

  it('picomatch `!` negation excludes everything except the negated pattern', () => {
    // `!important.log` matches anything that is NOT named `important.log`.
    const rules = [
      rule({ kind: 'exclude', pattern: '!important.log', target: 'name' }),
    ];
    const c = compileRules(rules);
    expect(evaluate(c, entry('boring.log'))).toBe('excluded');
    expect(evaluate(c, entry('important.log'))).toBe('kept');
  });

  it('matches dotfiles with `**` (dot: true)', () => {
    const rules = [rule({ kind: 'exclude', pattern: '**' })];
    const c = compileRules(rules);
    expect(evaluate(c, entry('.env'))).toBe('excluded');
    expect(evaluate(c, entry('.git/HEAD'))).toBe('excluded');
  });
});

describe('ruleMatcher — name vs path target', () => {
  it('defaults to matching against the relative path', () => {
    const rules = [rule({ kind: 'exclude', pattern: 'build/**' })];
    const c = compileRules(rules);
    expect(evaluate(c, entry('build/x.o'))).toBe('excluded');
    expect(evaluate(c, entry('src/build.ts'))).toBe('kept');
  });

  it("`target: 'name'` only inspects the basename", () => {
    const rules = [
      rule({ kind: 'exclude', pattern: '*.log', target: 'name' }),
    ];
    const c = compileRules(rules);
    expect(evaluate(c, entry('out.log'))).toBe('excluded');
    expect(evaluate(c, entry('deeply/nested/dir/out.log'))).toBe('excluded');
    expect(evaluate(c, entry('out.log.bak'))).toBe('kept');
  });
});

describe('ruleMatcher — ordered evaluation & precedence', () => {
  it('include rules turn the filter into a whitelist', () => {
    const rules = [rule({ kind: 'include', pattern: '**/*.ts' })];
    const compiled = compileRules(rules);
    expect(evaluate(compiled, entry('src/a.ts'))).toBe('kept');
    expect(evaluate(compiled, entry('src/a.js'))).toBe('excluded');
  });

  it('include after exclude: the include re-admits matching entries (last-wins)', () => {
    const rules = [
      rule({ kind: 'exclude', pattern: '**' }),
      rule({ kind: 'include', pattern: '**/*.ts' }),
    ];
    const c = compileRules(rules);
    expect(evaluate(c, entry('src/a.ts'))).toBe('kept');
    expect(evaluate(c, entry('src/a.js'))).toBe('excluded');
  });

  it('exclude after include: the exclude wins for entries it matches', () => {
    const rules = [
      rule({ kind: 'include', pattern: '**/*.ts' }),
      rule({ kind: 'exclude', pattern: '**/*.test.ts' }),
    ];
    const c = compileRules(rules);
    expect(evaluate(c, entry('src/a.ts'))).toBe('kept');
    expect(evaluate(c, entry('src/a.test.ts'))).toBe('excluded');
    expect(evaluate(c, entry('src/a.js'))).toBe('excluded'); // whitelist mode
  });

  it('three-rule stack: exclude → include → exclude (most specific wins)', () => {
    const rules = [
      rule({ kind: 'exclude', pattern: '**' }),
      rule({ kind: 'include', pattern: 'src/**' }),
      rule({ kind: 'exclude', pattern: 'src/**/__tests__/**' }),
    ];
    const c = compileRules(rules);
    expect(evaluate(c, entry('src/lib/a.ts'))).toBe('kept');
    expect(evaluate(c, entry('src/lib/__tests__/a.test.ts'))).toBe('excluded');
    expect(evaluate(c, entry('docs/readme.md'))).toBe('excluded');
  });
});

describe('ruleMatcher — size and mtime predicates', () => {
  it('applies size.gt predicate', () => {
    const rules = [
      rule({ kind: 'exclude', pattern: '**/*.bin', size: { gt: 1024 } }),
    ];
    const c = compileRules(rules);
    expect(evaluate(c, entry('a.bin', { size: 2048 }))).toBe('excluded');
    expect(evaluate(c, entry('a.bin', { size: 500 }))).toBe('kept');
  });

  it('applies size.lt predicate', () => {
    const rules = [rule({ kind: 'exclude', pattern: '**', size: { lt: 10 } })];
    const c = compileRules(rules);
    expect(evaluate(c, entry('tiny.txt', { size: 5 }))).toBe('excluded');
    expect(evaluate(c, entry('big.txt', { size: 50 }))).toBe('kept');
  });

  it('combines size.gt and size.lt (a band)', () => {
    const rules = [
      rule({ kind: 'exclude', pattern: '**', size: { gt: 100, lt: 1000 } }),
    ];
    const c = compileRules(rules);
    expect(evaluate(c, entry('mid.txt', { size: 500 }))).toBe('excluded');
    expect(evaluate(c, entry('small.txt', { size: 50 }))).toBe('kept');
    expect(evaluate(c, entry('big.txt', { size: 5000 }))).toBe('kept');
  });

  it('applies mtime.before and mtime.after', () => {
    const before = [
      rule({ kind: 'exclude', pattern: '**', mtime: { before: 500 } }),
    ];
    const cBefore = compileRules(before);
    expect(evaluate(cBefore, entry('old.txt', { mtimeMs: 100 }))).toBe('excluded');
    expect(evaluate(cBefore, entry('new.txt', { mtimeMs: 10_000 }))).toBe('kept');

    const after = [
      rule({ kind: 'exclude', pattern: '**', mtime: { after: 10_000 } }),
    ];
    const cAfter = compileRules(after);
    expect(evaluate(cAfter, entry('newer.txt', { mtimeMs: 20_000 }))).toBe('excluded');
    expect(evaluate(cAfter, entry('older.txt', { mtimeMs: 100 }))).toBe('kept');
  });

  it('predicates fail safely when the sample lacks size/mtime data', () => {
    const rules = [
      rule({ kind: 'exclude', pattern: '**', size: { gt: 0 } }),
    ];
    const c = compileRules(rules);
    // Sample missing `size` — the predicate cannot match, so the rule
    // doesn't fire and the default `kept` verdict stands.
    expect(evaluate(c, { relPath: 'a.txt' })).toBe('kept');
  });
});

describe('evaluateAll', () => {
  it('returns one verdict per sample, in order', () => {
    const rules = [rule({ kind: 'exclude', pattern: '**/*.log' })];
    const out = evaluateAll(rules, [
      { relPath: 'a.log' },
      { relPath: 'a.txt' },
      { relPath: 'sub/b.log' },
    ]);
    expect(out).toEqual(['excluded', 'kept', 'excluded']);
  });

  it('handles an empty rule set (everything kept)', () => {
    expect(evaluateAll([], [{ relPath: 'a' }, { relPath: 'b' }])).toEqual([
      'kept',
      'kept',
    ]);
  });
});
