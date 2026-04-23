import { describe, expect, it } from 'vitest';

import type { FsEntry, Rule } from '@awapi/shared';

import { compileRules, evaluate } from './ruleMatcher.js';

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

describe('ruleMatcher', () => {
  it('keeps everything when no rules are configured', () => {
    expect(evaluate(compileRules([]), entry('a/b.txt'))).toBe('kept');
  });

  it('ignores disabled rules', () => {
    const rules = [rule({ kind: 'exclude', pattern: '**/*.log', enabled: false })];
    expect(evaluate(compileRules(rules), entry('build/out.log'))).toBe('kept');
  });

  it('excludes when an exclude rule matches', () => {
    const rules = [rule({ kind: 'exclude', pattern: '**/*.log' })];
    expect(evaluate(compileRules(rules), entry('build/out.log'))).toBe('excluded');
    expect(evaluate(compileRules(rules), entry('src/index.ts'))).toBe('kept');
  });

  it('include rules turn the filter into a whitelist', () => {
    const rules = [rule({ kind: 'include', pattern: '**/*.ts' })];
    const compiled = compileRules(rules);
    expect(evaluate(compiled, entry('src/a.ts'))).toBe('kept');
    expect(evaluate(compiled, entry('src/a.js'))).toBe('excluded');
  });

  it('include rule takes precedence over a matching exclude rule', () => {
    const rules = [
      rule({ kind: 'exclude', pattern: '**' }),
      rule({ kind: 'include', pattern: '**/*.ts' }),
    ];
    const compiled = compileRules(rules);
    expect(evaluate(compiled, entry('src/a.ts'))).toBe('kept');
    expect(evaluate(compiled, entry('src/a.js'))).toBe('excluded');
  });

  it('applies size predicates', () => {
    const rules = [rule({ kind: 'exclude', pattern: '**/*.bin', size: { gt: 1024 } })];
    const compiled = compileRules(rules);
    expect(evaluate(compiled, entry('a.bin', { size: 2048 }))).toBe('excluded');
    expect(evaluate(compiled, entry('a.bin', { size: 500 }))).toBe('kept');
  });

  it('applies size.lt predicate', () => {
    const rules = [rule({ kind: 'exclude', pattern: '**', size: { lt: 10 } })];
    const compiled = compileRules(rules);
    expect(evaluate(compiled, entry('tiny.txt', { size: 5 }))).toBe('excluded');
    expect(evaluate(compiled, entry('big.txt', { size: 50 }))).toBe('kept');
  });

  it('applies mtime predicates', () => {
    const rules = [rule({ kind: 'exclude', pattern: '**', mtime: { before: 500 } })];
    const compiled = compileRules(rules);
    expect(evaluate(compiled, entry('old.txt', { mtimeMs: 100 }))).toBe('excluded');
    expect(evaluate(compiled, entry('new.txt', { mtimeMs: 10_000 }))).toBe('kept');

    const rules2 = [rule({ kind: 'exclude', pattern: '**', mtime: { after: 10_000 } })];
    const compiled2 = compileRules(rules2);
    expect(evaluate(compiled2, entry('newer.txt', { mtimeMs: 20_000 }))).toBe('excluded');
    expect(evaluate(compiled2, entry('older.txt', { mtimeMs: 100 }))).toBe('kept');
  });
});
