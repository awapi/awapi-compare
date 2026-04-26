import { describe, expect, it } from 'vitest';
import type { ComparedPair, FsEntry } from '@awapi/shared';
import { buildTreeRows, collectDirPaths } from './treeRows.js';

function dir(relPath: string, side: 'left' | 'right' | 'both' = 'both'): ComparedPair {
  const name = relPath.split('/').pop() ?? relPath;
  const entry: FsEntry = {
    relPath,
    name,
    type: 'dir',
    size: 0,
    mtimeMs: 0,
    mode: 0,
  };
  const pair: ComparedPair = { relPath, status: 'identical' };
  if (side === 'left' || side === 'both') pair.left = entry;
  if (side === 'right' || side === 'both') pair.right = entry;
  return pair;
}

function file(
  relPath: string,
  status: ComparedPair['status'] = 'identical',
  side: 'left' | 'right' | 'both' = 'both',
): ComparedPair {
  const name = relPath.split('/').pop() ?? relPath;
  const entry: FsEntry = {
    relPath,
    name,
    type: 'file',
    size: 1,
    mtimeMs: 0,
    mode: 0,
  };
  const pair: ComparedPair = { relPath, status };
  if (side === 'left' || side === 'both') pair.left = entry;
  if (side === 'right' || side === 'both') pair.right = entry;
  return pair;
}

describe('buildTreeRows', () => {
  it('returns an empty list for no pairs', () => {
    expect(buildTreeRows([], new Set())).toEqual([]);
  });

  it('groups files under their parent directories with depth and dir-first ordering', () => {
    const pairs: ComparedPair[] = [
      file('config/app.yaml'),
      file('config/database.json'),
      dir('config'),
      file('README.md'),
      dir('src'),
      file('src/index.ts'),
    ];
    const rows = buildTreeRows(pairs, new Set());
    expect(rows.map((r) => [r.pair.relPath, r.depth, r.isDir])).toEqual([
      ['config', 0, true],
      ['config/app.yaml', 1, false],
      ['config/database.json', 1, false],
      ['src', 0, true],
      ['src/index.ts', 1, false],
      ['README.md', 0, false],
    ]);
  });

  it('hides the descendants of a collapsed directory', () => {
    const pairs: ComparedPair[] = [
      dir('config'),
      file('config/app.yaml'),
      file('config/database.json'),
      file('README.md'),
    ];
    const rows = buildTreeRows(pairs, new Set(['config']));
    expect(rows.map((r) => r.pair.relPath)).toEqual(['config', 'README.md']);
    const configRow = rows[0];
    expect(configRow?.expanded).toBe(false);
    expect(configRow?.hasChildren).toBe(true);
  });

  it('flags directories that have no children as expanded but childless', () => {
    const pairs: ComparedPair[] = [dir('empty'), file('a.txt')];
    const rows = buildTreeRows(pairs, new Set());
    const emptyRow = rows.find((r) => r.pair.relPath === 'empty');
    expect(emptyRow).toBeDefined();
    expect(emptyRow?.isDir).toBe(true);
    expect(emptyRow?.hasChildren).toBe(false);
    expect(emptyRow?.expanded).toBe(true);
  });

  it('promotes orphan nodes whose parent directory is not in the pair list', () => {
    // No `config` dir pair exists (e.g. excluded by a rule) but its
    // children survive — they should still be shown rather than dropped.
    const pairs: ComparedPair[] = [
      file('config/app.yaml'),
      file('README.md'),
    ];
    const rows = buildTreeRows(pairs, new Set());
    expect(rows.map((r) => [r.pair.relPath, r.depth])).toEqual([
      ['config/app.yaml', 0],
      ['README.md', 0],
    ]);
  });

  it('treats a directory as such when only one side is a dir', () => {
    const onlyLeft = dir('only-left', 'left');
    onlyLeft.status = 'left-only';
    const pairs: ComparedPair[] = [
      onlyLeft,
      { ...file('only-left/child.txt', 'left-only', 'left') },
    ];
    const rows = buildTreeRows(pairs, new Set());
    expect(rows.map((r) => [r.pair.relPath, r.depth, r.isDir])).toEqual([
      ['only-left', 0, true],
      ['only-left/child.txt', 1, false],
    ]);
  });

  describe('displayStatus', () => {
    it('mirrors pair.status for files', () => {
      const pairs: ComparedPair[] = [file('a.txt', 'different')];
      const rows = buildTreeRows(pairs, new Set());
      expect(rows[0]?.displayStatus).toBe('different');
    });

    it('rolls up to "different" when any descendant differs', () => {
      const pairs: ComparedPair[] = [
        dir('config'),
        file('config/app.yaml', 'identical'),
        file('config/database.json', 'different'),
        dir('src'),
        file('src/index.ts', 'identical'),
      ];
      const rows = buildTreeRows(pairs, new Set());
      const byPath = new Map(rows.map((r) => [r.pair.relPath, r.displayStatus]));
      expect(byPath.get('config')).toBe('different');
      expect(byPath.get('src')).toBe('identical');
    });

    it('propagates differences through nested directories', () => {
      const pairs: ComparedPair[] = [
        dir('a'),
        dir('a/b'),
        dir('a/b/c'),
        file('a/b/c/leaf.txt', 'newer-right'),
      ];
      const rows = buildTreeRows(pairs, new Set());
      const byPath = new Map(rows.map((r) => [r.pair.relPath, r.displayStatus]));
      expect(byPath.get('a')).toBe('different');
      expect(byPath.get('a/b')).toBe('different');
      expect(byPath.get('a/b/c')).toBe('different');
    });

    it('aggregates even when descendant rows are hidden by collapse', () => {
      const pairs: ComparedPair[] = [
        dir('config'),
        file('config/app.yaml', 'different'),
      ];
      const rows = buildTreeRows(pairs, new Set(['config']));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.displayStatus).toBe('different');
    });

    it('preserves an inherent left-only / right-only directory status', () => {
      const onlyLeft = dir('only-left', 'left');
      onlyLeft.status = 'left-only';
      const pairs: ComparedPair[] = [
        onlyLeft,
        { ...file('only-left/child.txt', 'left-only', 'left') },
      ];
      const rows = buildTreeRows(pairs, new Set());
      expect(rows[0]?.displayStatus).toBe('left-only');
    });

    it('reports identical when every descendant is identical', () => {
      const pairs: ComparedPair[] = [
        dir('same'),
        file('same/a.json', 'identical'),
        file('same/b.json', 'identical'),
      ];
      const rows = buildTreeRows(pairs, new Set());
      const sameRow = rows.find((r) => r.pair.relPath === 'same');
      expect(sameRow?.displayStatus).toBe('identical');
    });
  });
});

describe('collectDirPaths', () => {
  it('returns the relPath of every directory pair', () => {
    const pairs: ComparedPair[] = [
      dir('a'),
      file('a/x.ts'),
      dir('a/b'),
      file('readme.md'),
    ];
    expect(collectDirPaths(pairs).sort()).toEqual(['a', 'a/b']);
  });
});
