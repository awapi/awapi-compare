import { describe, expect, it } from 'vitest';
import type { ComparedPair, FsEntry } from '@awapi/shared';
import {
  ROW_ACTION_ACCELERATORS,
  ROW_ACTION_LABELS,
  buildRowMenuItems,
  isActionEnabled,
} from './actions.js';

function entry(name: string, type: FsEntry['type'] = 'file'): FsEntry {
  return {
    relPath: name,
    name,
    type,
    size: 1,
    mtimeMs: 0,
    mode: 0o644,
  };
}

function pair(
  status: ComparedPair['status'],
  opts: { left?: boolean; right?: boolean } = { left: true, right: true },
): ComparedPair {
  return {
    relPath: 'foo.txt',
    status,
    left: opts.left ? entry('foo.txt') : undefined,
    right: opts.right ? entry('foo.txt') : undefined,
  };
}

describe('isActionEnabled', () => {
  it('compare is always enabled', () => {
    expect(isActionEnabled('compare', {})).toBe(true);
    expect(isActionEnabled('compare', { pair: pair('different') })).toBe(true);
  });

  it('row actions require a pair', () => {
    for (const action of [
      'open',
      'copyLeftToRight',
      'copyRightToLeft',
      'delete',
      'markSame',
      'exclude',
      'openSelectedFolders',
      'useAsLeftFolderOnly',
      'useAsRightFolderOnly',
    ] as const) {
      expect(isActionEnabled(action, {})).toBe(false);
    }
  });

  it('copy L→R requires a left side', () => {
    expect(
      isActionEnabled('copyLeftToRight', { pair: pair('right-only', { right: true }) }),
    ).toBe(false);
    expect(
      isActionEnabled('copyLeftToRight', { pair: pair('left-only', { left: true }) }),
    ).toBe(true);
  });

  it('copy R→L requires a right side', () => {
    expect(
      isActionEnabled('copyRightToLeft', { pair: pair('left-only', { left: true }) }),
    ).toBe(false);
    expect(
      isActionEnabled('copyRightToLeft', { pair: pair('right-only', { right: true }) }),
    ).toBe(true);
  });

  it('markSame requires both sides', () => {
    expect(
      isActionEnabled('markSame', { pair: pair('left-only', { left: true }) }),
    ).toBe(false);
    expect(isActionEnabled('markSame', { pair: pair('different') })).toBe(true);
  });

  it('delete requires at least one side', () => {
    const empty: ComparedPair = { relPath: 'x', status: 'identical' };
    expect(isActionEnabled('delete', { pair: empty })).toBe(false);
    expect(isActionEnabled('delete', { pair: pair('left-only', { left: true }) })).toBe(
      true,
    );
  });

  it('open is disabled for error pairs', () => {
    expect(isActionEnabled('open', { pair: pair('error') })).toBe(false);
  });

  it('useAsLeftFolderOnly requires a left-side directory entry', () => {
    expect(isActionEnabled('useAsLeftFolderOnly', { pair: pair('different') })).toBe(false);
    const dirPair: ComparedPair = {
      relPath: 'sub',
      status: 'different',
      left: entry('sub', 'dir'),
      right: entry('sub', 'dir'),
    };
    expect(isActionEnabled('useAsLeftFolderOnly', { pair: dirPair })).toBe(true);
    expect(isActionEnabled('useAsRightFolderOnly', { pair: dirPair })).toBe(true);
    expect(isActionEnabled('openSelectedFolders', { pair: dirPair })).toBe(true);
  });

  it('useAsRightFolderOnly is disabled when the right side is missing', () => {
    const leftOnlyDir: ComparedPair = {
      relPath: 'sub',
      status: 'left-only',
      left: entry('sub', 'dir'),
    };
    expect(isActionEnabled('useAsLeftFolderOnly', { pair: leftOnlyDir })).toBe(true);
    expect(isActionEnabled('useAsRightFolderOnly', { pair: leftOnlyDir })).toBe(false);
    // openSelectedFolders is enabled as long as at least one side is a dir.
    expect(isActionEnabled('openSelectedFolders', { pair: leftOnlyDir })).toBe(true);
  });

  it('openSelectedFolders is disabled when neither side is a directory', () => {
    expect(isActionEnabled('openSelectedFolders', { pair: pair('different') })).toBe(false);
  });
});

describe('buildRowMenuItems', () => {
  it('produces every action in a stable order with labels and accelerators', () => {
    const items = buildRowMenuItems({ pair: pair('different') });
    expect(items.map((i) => i.action)).toEqual([
      'open',
      'compare',
      'copyLeftToRight',
      'copyRightToLeft',
      'delete',
      'markSame',
      'exclude',
      'openSelectedFolders',
      'useAsLeftFolderOnly',
      'useAsRightFolderOnly',
    ]);
    for (const item of items) {
      expect(item.label).toBe(ROW_ACTION_LABELS[item.action]);
      expect(item.accelerator).toBe(ROW_ACTION_ACCELERATORS[item.action]);
    }
  });

  it('marks unavailable actions as disabled but still includes them', () => {
    const items = buildRowMenuItems({ pair: pair('left-only', { left: true }) });
    const disabled = items.filter((i) => i.disabled).map((i) => i.action);
    expect(disabled).toEqual(expect.arrayContaining(['copyRightToLeft', 'markSame']));
    expect(disabled).not.toContain('compare');
    expect(items).toHaveLength(10);
  });

  it('disables every row action when no pair is focused', () => {
    const items = buildRowMenuItems({});
    expect(items.find((i) => i.action === 'compare')?.disabled).toBe(false);
    for (const item of items.filter((i) => i.action !== 'compare')) {
      expect(item.disabled).toBe(true);
    }
  });
});
