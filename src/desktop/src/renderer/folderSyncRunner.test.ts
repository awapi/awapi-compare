import { describe, expect, it, vi } from 'vitest';
import type { FolderSyncPlan } from '@awapi/shared';

import { runFolderSync } from './folderSyncRunner.js';

const plan: FolderSyncPlan = {
  mode: 'mirror-left-to-right',
  items: [
    { relPath: 'a.txt', op: 'copy-left-to-right', entryType: 'file', overwrite: false },
    { relPath: 'b.txt', op: 'copy-right-to-left', entryType: 'file', overwrite: true },
    { relPath: 'c.txt', op: 'delete-right', entryType: 'file', overwrite: false },
    { relPath: 'd.txt', op: 'delete-left', entryType: 'file', overwrite: false },
  ],
  conflicts: [],
  summary: { copyLeftToRight: 1, copyRightToLeft: 1, deleteLeft: 1, deleteRight: 1, conflicts: 0 },
};

function makeFs() {
  return {
    copy: vi.fn().mockResolvedValue({ copied: 1, skipped: 0, errors: [] }),
    rm: vi.fn().mockResolvedValue({ deleted: 1, errors: [] }),
  };
}

describe('runFolderSync', () => {
  it('maps each item onto the right fs call and path', async () => {
    const fs = makeFs();
    const onProgress = vi.fn();
    const result = await runFolderSync(plan, { leftRoot: '/L', rightRoot: '/R', fs, onProgress });
    expect(fs.copy).toHaveBeenNthCalledWith(1, { from: '/L/a.txt', to: '/R/a.txt', overwrite: false });
    expect(fs.copy).toHaveBeenNthCalledWith(2, { from: '/R/b.txt', to: '/L/b.txt', overwrite: true });
    expect(fs.rm).toHaveBeenNthCalledWith(1, { paths: ['/R/c.txt'] });
    expect(fs.rm).toHaveBeenNthCalledWith(2, { paths: ['/L/d.txt'] });
    expect(result).toEqual({ succeeded: 4, failed: 0, errors: [] });
    expect(onProgress).toHaveBeenLastCalledWith(4, 4);
    expect(onProgress).toHaveBeenCalledTimes(4);
  });

  it('collects reported and thrown errors and keeps going', async () => {
    const fs = makeFs();
    fs.copy
      .mockResolvedValueOnce({ copied: 0, skipped: 0, errors: [{ path: 'x', message: 'denied' }] })
      .mockRejectedValueOnce(new Error('boom'));
    fs.rm.mockRejectedValueOnce('plain failure');
    const result = await runFolderSync(plan, { leftRoot: '/L', rightRoot: '/R', fs });
    expect(result).toEqual({
      succeeded: 1,
      failed: 3,
      errors: ['a.txt: denied', 'b.txt: boom', 'c.txt: plain failure'],
    });
    expect(fs.rm).toHaveBeenCalledTimes(2);
  });

  it('rejects when a root is missing', async () => {
    await expect(
      runFolderSync(plan, { leftRoot: '/L', rightRoot: ' ', fs: makeFs() }),
    ).rejects.toThrow(/both folder roots/i);
  });
});
