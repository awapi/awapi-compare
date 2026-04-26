import { describe, expect, it } from 'vitest';

import type { Rule } from './types.js';
import {
  EMPTY_SIMPLE_RULES,
  SIMPLE_INCLUDE_FILES_DEFAULT,
  SIMPLE_INCLUDE_FOLDERS_DEFAULT,
  compileSimpleRules,
  tryDecompileToSimpleRules,
} from './simpleRules.js';

let nextId = 0;
function id(): string {
  return `r${++nextId}`;
}

function rule(partial: Partial<Rule>): Rule {
  return {
    id: id(),
    kind: 'exclude',
    pattern: '**',
    enabled: true,
    ...partial,
  };
}

describe('compileSimpleRules', () => {
  it('returns an empty rule list for the default empty payload', () => {
    expect(compileSimpleRules(EMPTY_SIMPLE_RULES)).toEqual([]);
  });

  it('emits exclude-folder pairs (name + path) for each folder glob', () => {
    const out = compileSimpleRules({
      includeFiles: [SIMPLE_INCLUDE_FILES_DEFAULT],
      excludeFiles: [],
      includeFolders: [SIMPLE_INCLUDE_FOLDERS_DEFAULT],
      excludeFolders: ['.git', 'node_modules'],
    });
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({
      kind: 'exclude',
      target: 'name',
      scope: 'folder',
      pattern: '.git',
      enabled: true,
    });
    expect(out[1]).toMatchObject({
      kind: 'exclude',
      target: 'path',
      pattern: '**/.git/**',
      enabled: true,
    });
    expect(out[2]).toMatchObject({
      kind: 'exclude',
      target: 'name',
      scope: 'folder',
      pattern: 'node_modules',
    });
    expect(out[3]).toMatchObject({
      target: 'path',
      pattern: '**/node_modules/**',
    });
  });

  it('emits one rule per file-exclude glob with scope=file', () => {
    const out = compileSimpleRules({
      includeFiles: [SIMPLE_INCLUDE_FILES_DEFAULT],
      excludeFiles: ['*.log', '*.tmp'],
      includeFolders: [SIMPLE_INCLUDE_FOLDERS_DEFAULT],
      excludeFolders: [],
    });
    expect(out).toHaveLength(2);
    for (const r of out) {
      expect(r).toMatchObject({
        kind: 'exclude',
        target: 'name',
        scope: 'file',
        enabled: true,
      });
    }
    expect(out.map((r) => r.pattern)).toEqual(['*.log', '*.tmp']);
  });

  it('does NOT emit include rules when include axes are at their defaults', () => {
    const out = compileSimpleRules({
      includeFiles: [SIMPLE_INCLUDE_FILES_DEFAULT],
      excludeFiles: ['*.log'],
      includeFolders: [SIMPLE_INCLUDE_FOLDERS_DEFAULT],
      excludeFolders: ['.git'],
    });
    expect(out.some((r) => r.kind === 'include')).toBe(false);
  });

  it('emits include-files rules when include-files differs from the default', () => {
    const out = compileSimpleRules({
      includeFiles: ['*.ts'],
      excludeFiles: [],
      includeFolders: [SIMPLE_INCLUDE_FOLDERS_DEFAULT],
      excludeFolders: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'include',
      target: 'name',
      scope: 'file',
      pattern: '*.ts',
    });
  });

  it('emits include-folders rules when include-folders differs from the default', () => {
    const out = compileSimpleRules({
      includeFiles: [SIMPLE_INCLUDE_FILES_DEFAULT],
      excludeFiles: [],
      includeFolders: ['src', 'docs'],
      excludeFolders: [],
    });
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.pattern)).toEqual(['src', 'docs']);
    for (const r of out) {
      expect(r).toMatchObject({ kind: 'include', scope: 'folder', target: 'name' });
    }
  });

  it('orders rules: exclude-folders, exclude-files, include-folders, include-files', () => {
    const out = compileSimpleRules({
      includeFiles: ['*.ts'],
      excludeFiles: ['*.log'],
      includeFolders: ['src'],
      excludeFolders: ['.git'],
    });
    const kinds = out.map((r) => `${r.kind}:${r.target}:${r.scope ?? 'any'}:${r.pattern}`);
    expect(kinds).toEqual([
      'exclude:name:folder:.git',
      'exclude:path:any:**/.git/**',
      'exclude:name:file:*.log',
      'include:name:folder:src',
      'include:name:file:*.ts',
    ]);
  });

  it('trims whitespace and drops empty entries on every axis', () => {
    const out = compileSimpleRules({
      includeFiles: [SIMPLE_INCLUDE_FILES_DEFAULT],
      excludeFiles: ['  *.log  ', '', '   '],
      includeFolders: [SIMPLE_INCLUDE_FOLDERS_DEFAULT],
      excludeFolders: ['  .git  ', ''],
    });
    expect(out.map((r) => r.pattern)).toEqual(['.git', '**/.git/**', '*.log']);
  });

  it('uses the injected id factory for every emitted rule', () => {
    let n = 0;
    const out = compileSimpleRules(
      {
        includeFiles: [SIMPLE_INCLUDE_FILES_DEFAULT],
        excludeFiles: ['*.log'],
        includeFolders: [SIMPLE_INCLUDE_FOLDERS_DEFAULT],
        excludeFolders: ['.git'],
      },
      { newId: () => `id-${++n}` },
    );
    expect(out.map((r) => r.id)).toEqual(['id-1', 'id-2', 'id-3']);
  });
});

describe('tryDecompileToSimpleRules', () => {
  it('returns the empty payload for an empty rule list', () => {
    expect(tryDecompileToSimpleRules([])).toEqual(EMPTY_SIMPLE_RULES);
  });

  it('round-trips the empty payload', () => {
    const compiled = compileSimpleRules(EMPTY_SIMPLE_RULES);
    expect(tryDecompileToSimpleRules(compiled)).toEqual(EMPTY_SIMPLE_RULES);
  });

  it('round-trips a rich payload', () => {
    const payload = {
      includeFiles: ['*.ts', '*.tsx'],
      excludeFiles: ['*.log', '*.tmp'],
      includeFolders: ['src', 'docs'],
      excludeFolders: ['.git', 'node_modules', 'dist'],
    };
    const compiled = compileSimpleRules(payload);
    expect(tryDecompileToSimpleRules(compiled)).toEqual(payload);
  });

  it('returns null when a rule has a size predicate', () => {
    const compiled = compileSimpleRules({
      includeFiles: [SIMPLE_INCLUDE_FILES_DEFAULT],
      excludeFiles: ['*.log'],
      includeFolders: [SIMPLE_INCLUDE_FOLDERS_DEFAULT],
      excludeFolders: [],
    });
    compiled[0]!.size = { gt: 1024 };
    expect(tryDecompileToSimpleRules(compiled)).toBeNull();
  });

  it('returns null when a rule has an mtime predicate', () => {
    const compiled = compileSimpleRules({
      includeFiles: [SIMPLE_INCLUDE_FILES_DEFAULT],
      excludeFiles: ['*.log'],
      includeFolders: [SIMPLE_INCLUDE_FOLDERS_DEFAULT],
      excludeFolders: [],
    });
    compiled[0]!.mtime = { after: 1 };
    expect(tryDecompileToSimpleRules(compiled)).toBeNull();
  });

  it('returns null when a rule is disabled', () => {
    const compiled = compileSimpleRules({
      includeFiles: [SIMPLE_INCLUDE_FILES_DEFAULT],
      excludeFiles: ['*.log'],
      includeFolders: [SIMPLE_INCLUDE_FOLDERS_DEFAULT],
      excludeFolders: [],
    });
    compiled[0]!.enabled = false;
    expect(tryDecompileToSimpleRules(compiled)).toBeNull();
  });

  it('returns null when an exclude-folder name is missing its descendant pair', () => {
    const rules: Rule[] = [
      rule({
        kind: 'exclude',
        target: 'name',
        scope: 'folder',
        pattern: '.git',
      }),
    ];
    expect(tryDecompileToSimpleRules(rules)).toBeNull();
  });

  it('returns null when an exclude-folder descendant rule appears without its name pair', () => {
    const rules: Rule[] = [
      rule({ kind: 'exclude', target: 'path', pattern: '**/.git/**' }),
    ];
    expect(tryDecompileToSimpleRules(rules)).toBeNull();
  });

  it('returns null when ordering is non-canonical', () => {
    const rules: Rule[] = [
      rule({ kind: 'exclude', target: 'name', scope: 'file', pattern: '*.log' }),
      rule({ kind: 'exclude', target: 'name', scope: 'folder', pattern: '.git' }),
      rule({ kind: 'exclude', target: 'path', pattern: '**/.git/**' }),
    ];
    expect(tryDecompileToSimpleRules(rules)).toBeNull();
  });

  it('returns null for rule shapes the simple view does not recognise', () => {
    // A path-targeted exclude that is NOT the descendant pattern.
    const rules: Rule[] = [rule({ kind: 'exclude', target: 'path', pattern: 'src/**' })];
    expect(tryDecompileToSimpleRules(rules)).toBeNull();
  });

  it('returns null for include rules with unsupported scopes', () => {
    const rules: Rule[] = [
      rule({ kind: 'include', target: 'name', scope: 'any', pattern: '*.ts' }),
    ];
    expect(tryDecompileToSimpleRules(rules)).toBeNull();
  });
});
