import { describe, expect, it } from 'vitest';

import {
  FOLDER_SYNC_MODES,
  countFolderSyncDeletes,
  planFolderSync,
  type FolderSyncMode,
} from './folderSync.js';
import type { ComparedPair, DiffStatus, EntryType, FsEntry } from './types.js';

function entry(relPath: string, type: EntryType = 'file'): FsEntry {
  return { relPath, name: relPath.split('/').pop() ?? relPath, type, size: 1, mtimeMs: 0, mode: 0 };
}

function pair(
  relPath: string,
  status: DiffStatus,
  opts: { left?: EntryType; right?: EntryType } = {},
): ComparedPair {
  const defaults = {
    'left-only': { left: 'file', right: undefined },
    'right-only': { left: undefined, right: 'file' },
  } as const;
  const base = status === 'left-only' || status === 'right-only' ? defaults[status] : { left: 'file', right: 'file' };
  const l = 'left' in opts ? opts.left : base.left;
  const r = 'right' in opts ? opts.right : base.right;
  return {
    relPath,
    status,
    ...(l ? { left: entry(relPath, l) } : {}),
    ...(r ? { right: entry(relPath, r) } : {}),
  } as ComparedPair;
}

function ops(pairs: ComparedPair[], mode: FolderSyncMode): string[] {
  return planFolderSync(pairs, mode).items.map((i) => `${i.op}:${i.relPath}`);
}

const SAMPLE: ComparedPair[] = [
  pair('lonely-left.txt', 'left-only'),
  pair('lonely-right.txt', 'right-only'),
  pair('newer-left.txt', 'newer-left'),
  pair('newer-right.txt', 'newer-right'),
  pair('same.txt', 'identical'),
];

describe('planFolderSync', () => {
  it('mirror left → right copies, overwrites regardless of age and deletes right-only', () => {
    const plan = planFolderSync(SAMPLE, 'mirror-left-to-right');
    expect(plan.items.map((i) => [i.op, i.relPath, i.overwrite])).toEqual([
      ['copy-left-to-right', 'lonely-left.txt', false],
      ['copy-left-to-right', 'newer-left.txt', true],
      ['copy-left-to-right', 'newer-right.txt', true],
      ['delete-right', 'lonely-right.txt', false],
    ]);
    expect(plan.summary).toEqual({
      copyLeftToRight: 3,
      copyRightToLeft: 0,
      deleteLeft: 0,
      deleteRight: 1,
      conflicts: 0,
    });
    expect(countFolderSyncDeletes(plan)).toBe(1);
  });

  it('mirror right → left is the mirror image', () => {
    expect(ops(SAMPLE, 'mirror-right-to-left')).toEqual([
      'copy-right-to-left:lonely-right.txt',
      'copy-right-to-left:newer-left.txt',
      'copy-right-to-left:newer-right.txt',
      'delete-left:lonely-left.txt',
    ]);
  });

  it('update left → right copies new and newer items and never deletes', () => {
    const plan = planFolderSync(SAMPLE, 'update-left-to-right');
    expect(ops(SAMPLE, 'update-left-to-right')).toEqual([
      'copy-left-to-right:lonely-left.txt',
      'copy-left-to-right:newer-left.txt',
    ]);
    expect(countFolderSyncDeletes(plan)).toBe(0);
  });

  it('update right → left copies new and newer items and never deletes', () => {
    expect(ops(SAMPLE, 'update-right-to-left')).toEqual([
      'copy-right-to-left:lonely-right.txt',
      'copy-right-to-left:newer-right.txt',
    ]);
  });

  it('two-way copies orphans across and the newer file over the older', () => {
    expect(ops(SAMPLE, 'two-way')).toEqual([
      'copy-left-to-right:lonely-left.txt',
      'copy-right-to-left:lonely-right.txt',
      'copy-left-to-right:newer-left.txt',
      'copy-right-to-left:newer-right.txt',
    ]);
  });

  it('reports differing pairs with no newer side as conflicts outside mirror modes', () => {
    const pairs = [pair('x.txt', 'different')];
    for (const mode of ['update-left-to-right', 'update-right-to-left', 'two-way'] as const) {
      const plan = planFolderSync(pairs, mode);
      expect(plan.items).toEqual([]);
      expect(plan.conflicts).toEqual([
        { relPath: 'x.txt', reason: 'Differs but neither side is newer' },
      ]);
      expect(plan.summary.conflicts).toBe(1);
    }
  });

  it('mirror resolves differing pairs without a newer side by copying the source', () => {
    expect(ops([pair('x.txt', 'different')], 'mirror-right-to-left')).toEqual([
      'copy-right-to-left:x.txt',
    ]);
  });

  it('reports a file/folder mismatch as a conflict in every mode', () => {
    const pairs = [pair('m', 'different', { left: 'file', right: 'dir' })];
    for (const mode of FOLDER_SYNC_MODES) {
      const plan = planFolderSync(pairs, mode);
      expect(plan.items).toEqual([]);
      expect(plan.conflicts).toEqual([
        { relPath: 'm', reason: 'File on one side, folder on the other' },
      ]);
    }
  });

  it('ignores identical, excluded and error pairs', () => {
    const pairs = [
      pair('a', 'identical'),
      pair('b', 'excluded'),
      { relPath: 'c', status: 'error', error: 'boom' } as ComparedPair,
    ];
    for (const mode of FOLDER_SYNC_MODES) {
      const plan = planFolderSync(pairs, mode);
      expect(plan.items).toEqual([]);
      expect(plan.conflicts).toEqual([]);
    }
  });

  it('ignores malformed orphan and differing pairs that lack an entry', () => {
    const pairs = [
      { relPath: 'a', status: 'left-only' },
      { relPath: 'b', status: 'right-only' },
      { relPath: 'c', status: 'newer-left', left: entry('c') },
    ] as ComparedPair[];
    for (const mode of FOLDER_SYNC_MODES) {
      expect(planFolderSync(pairs, mode).items).toEqual([]);
    }
  });

  it('collapses descendants into a copied folder', () => {
    const pairs = [
      pair('d', 'left-only', { left: 'dir' }),
      pair('d/a.txt', 'left-only'),
      pair('d/sub', 'left-only', { left: 'dir' }),
      pair('d/sub/b.txt', 'left-only'),
      pair('dd.txt', 'left-only'),
    ];
    const plan = planFolderSync(pairs, 'update-left-to-right');
    expect(plan.items.map((i) => [i.relPath, i.entryType])).toEqual([
      ['d', 'dir'],
      ['dd.txt', 'file'],
    ]);
  });

  it('collapses descendants into a deleted folder', () => {
    const pairs = [
      pair('gone', 'right-only', { right: 'dir' }),
      pair('gone/a.txt', 'right-only'),
    ];
    const plan = planFolderSync(pairs, 'mirror-left-to-right');
    expect(plan.items).toEqual([
      { relPath: 'gone', op: 'delete-right', entryType: 'dir', overwrite: false },
    ]);
  });

  it('keeps operations for descendants of a folder present on both sides', () => {
    const pairs = [
      pair('d', 'identical', { left: 'dir', right: 'dir' }),
      pair('d/a.txt', 'left-only'),
      pair('d/b.txt', 'newer-left'),
    ];
    expect(ops(pairs, 'update-left-to-right')).toEqual([
      'copy-left-to-right:d/a.txt',
      'copy-left-to-right:d/b.txt',
    ]);
  });

  it('orders copies before deletions', () => {
    const pairs = [pair('a', 'right-only'), pair('z', 'left-only')];
    expect(ops(pairs, 'mirror-left-to-right')).toEqual([
      'copy-left-to-right:z',
      'delete-right:a',
    ]);
  });

  it('sorts conflicts by path', () => {
    const plan = planFolderSync(
      [pair('b', 'different'), pair('a', 'different')],
      'two-way',
    );
    expect(plan.conflicts.map((c) => c.relPath)).toEqual(['a', 'b']);
  });

  it('returns an empty plan for no pairs', () => {
    expect(planFolderSync([], 'two-way')).toEqual({
      mode: 'two-way',
      items: [],
      conflicts: [],
      summary: {
        copyLeftToRight: 0,
        copyRightToLeft: 0,
        deleteLeft: 0,
        deleteRight: 0,
        conflicts: 0,
      },
    });
  });

  it('counts left deletions in the summary', () => {
    const plan = planFolderSync([pair('a', 'left-only')], 'mirror-right-to-left');
    expect(plan.summary.deleteLeft).toBe(1);
    expect(countFolderSyncDeletes(plan)).toBe(1);
  });
});
