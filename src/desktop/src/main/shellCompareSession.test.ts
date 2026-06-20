import { describe, expect, it } from 'vitest';

import { detectShellEntryKind, resolveShellCompareType } from './shellCompareSession.js';

function fileStat() {
  return { isFile: () => true, isDirectory: () => false };
}

function folderStat() {
  return { isFile: () => false, isDirectory: () => true };
}

function otherStat() {
  return { isFile: () => false, isDirectory: () => false };
}

describe('detectShellEntryKind', () => {
  it('detects file', async () => {
    const kind = await detectShellEntryKind('a.txt', async () => fileStat());
    expect(kind).toBe('file');
  });

  it('detects folder', async () => {
    const kind = await detectShellEntryKind('a', async () => folderStat());
    expect(kind).toBe('folder');
  });

  it('detects other', async () => {
    const kind = await detectShellEntryKind('pipe', async () => otherStat());
    expect(kind).toBe('other');
  });

  it('detects missing on stat error', async () => {
    const kind = await detectShellEntryKind('missing', async () => {
      throw new Error('ENOENT');
    });
    expect(kind).toBe('missing');
  });
});

describe('resolveShellCompareType', () => {
  it('returns file for file-file pair', async () => {
    const type = await resolveShellCompareType('a.txt', 'b.txt', async () => fileStat());
    expect(type).toBe('file');
  });

  it('returns folder for folder-folder pair', async () => {
    const type = await resolveShellCompareType('left', 'right', async () => folderStat());
    expect(type).toBe('folder');
  });

  it('returns null for mixed file-folder pair', async () => {
    const type = await resolveShellCompareType('a.txt', 'folder', async (path) =>
      path.endsWith('.txt') ? fileStat() : folderStat(),
    );
    expect(type).toBeNull();
  });

  it('returns null when one side is missing', async () => {
    const type = await resolveShellCompareType('a', 'missing', async (path) => {
      if (path === 'missing') throw new Error('ENOENT');
      return folderStat();
    });
    expect(type).toBeNull();
  });

  it('returns null for unsupported other kinds', async () => {
    const type = await resolveShellCompareType('a', 'b', async () => otherStat());
    expect(type).toBeNull();
  });
});
