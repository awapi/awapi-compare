import { describe, expect, it, vi } from 'vitest';
import { FS_ERROR_EXTERNAL_MODIFICATION } from '@awapi/shared';

import { loadMerge, saveMergeResult, type MergeFsApi } from './mergeFiles.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function makeFs(files: Record<string, Uint8Array | string>): MergeFsApi & {
  write: ReturnType<typeof vi.fn>;
} {
  return {
    read: vi.fn(async ({ path }: { path: string }) => {
      const f = files[path];
      if (f === undefined) throw new Error(`ENOENT ${path}`);
      const data = typeof f === 'string' ? enc(f) : f;
      return { data, size: data.length, mtimeMs: 1000 };
    }),
    stat: vi.fn(async () => ({ size: 1, mtimeMs: 2000, type: 'file' })),
    write: vi.fn(async () => undefined),
  };
}

const paths = { base: '/b.ts', left: '/l.ts', right: '/r.ts', output: '/o.ts' };

describe('loadMerge', () => {
  it('merges the three files and reports output metadata', async () => {
    const fs = makeFs({
      '/b.ts': 'a\nb\nc\n',
      '/l.ts': 'a\nL\nc\n',
      '/r.ts': 'a\nb\nc\nd\n',
      '/o.ts': 'old\n',
    });
    const loaded = await loadMerge(paths, fs);
    expect(loaded.merge.regions.map((r) => r.kind)).toEqual(['stable', 'left', 'stable', 'right']);
    expect(loaded.finalNewline).toBe(true);
    expect(loaded.eol).toBe('\n');
    expect(loaded.language).toBe('typescript');
    expect(loaded.outputEncoding).toBe('utf-8');
    expect(loaded.outputMtimeMs).toBe(1000);
  });

  it('treats a blank base path as an empty base', async () => {
    const fs = makeFs({ '/l.ts': 'x\n', '/r.ts': 'y\n' });
    const loaded = await loadMerge({ ...paths, base: '  ', output: '' }, fs);
    expect(loaded.merge.regions.map((r) => r.kind)).toEqual(['conflict']);
    expect(loaded.outputMtimeMs).toBeUndefined();
    expect(fs.read).toHaveBeenCalledTimes(2);
  });

  it('falls back to the left encoding when the output does not exist', async () => {
    const withBom = Uint8Array.from([0xef, 0xbb, 0xbf, ...enc('hi\n')]);
    const fs = makeFs({ '/b.ts': 'hi\n', '/l.ts': withBom, '/r.ts': 'hi\n' });
    const loaded = await loadMerge(paths, fs);
    expect(loaded.outputEncoding).toBe('utf-8-bom');
    expect(loaded.outputMtimeMs).toBeUndefined();
  });

  it('uses the existing output file encoding', async () => {
    const withBom = Uint8Array.from([0xef, 0xbb, 0xbf, ...enc('hi\n')]);
    const fs = makeFs({ '/b.ts': 'hi\n', '/l.ts': 'hi\n', '/r.ts': 'hi\n', '/o.ts': withBom });
    expect((await loadMerge(paths, fs)).outputEncoding).toBe('utf-8-bom');
  });

  it('requires left and right paths', async () => {
    const fs = makeFs({});
    await expect(loadMerge({ ...paths, left: '' }, fs)).rejects.toThrow(/left and a right/);
    await expect(loadMerge({ ...paths, right: ' ' }, fs)).rejects.toThrow(/left and a right/);
  });

  it('labels read failures and rejects binary input', async () => {
    const fs = makeFs({ '/l.ts': 'x', '/r.ts': 'y' });
    await expect(loadMerge(paths, fs)).rejects.toThrow(/^Base: ENOENT/);
    const fs2 = makeFs({ '/b.ts': '', '/l.ts': 'x', '/r.ts': Uint8Array.from([0, 1, 2, 0, 0, 3]) });
    await expect(loadMerge(paths, fs2)).rejects.toThrow(/Right: \/r\.ts is not a text file/);
  });
});

describe('saveMergeResult', () => {
  it('writes UTF-8 text with the external-modification guard and returns the new mtime', async () => {
    const fs = makeFs({});
    const out = await saveMergeResult('hello', 'utf-8', '/o', 1000, fs);
    expect(out).toEqual({ ok: true, mtimeMs: 2000 });
    expect(fs.write).toHaveBeenCalledWith({
      path: '/o',
      contents: 'hello',
      encoding: 'utf8',
      expectedMtimeMs: 1000,
    });
  });

  it('omits the guard for a file that did not exist', async () => {
    const fs = makeFs({});
    await saveMergeResult('x', 'utf-8', '/o', undefined, fs);
    expect(fs.write.mock.calls[0]?.[0]).not.toHaveProperty('expectedMtimeMs');
  });

  it('writes raw bytes for non-UTF-8 encodings', async () => {
    const fs = makeFs({});
    await saveMergeResult('é', 'windows-1252', '/o', undefined, fs);
    const req = fs.write.mock.calls[0]?.[0] as { contents: Uint8Array; encoding: string };
    expect(req.encoding).toBe('binary');
    expect(Array.from(req.contents)).toEqual([0xe9]);
  });

  it('refuses to write unrepresentable characters', async () => {
    const fs = makeFs({});
    const out = await saveMergeResult('日本', 'windows-1252', '/o', undefined, fs);
    expect(out).toMatchObject({ ok: false, reason: 'error' });
    expect(fs.write).not.toHaveBeenCalled();
  });

  it('reports external modification and generic failures', async () => {
    const fs = makeFs({});
    fs.write.mockRejectedValueOnce(
      Object.assign(new Error('changed'), { code: FS_ERROR_EXTERNAL_MODIFICATION }),
    );
    expect(await saveMergeResult('x', 'utf-8', '/o', 1, fs)).toEqual({
      ok: false,
      reason: 'external-modification',
      message: 'changed',
    });
    fs.write.mockRejectedValueOnce('boom');
    expect(await saveMergeResult('x', 'utf-8', '/o', 1, fs)).toEqual({
      ok: false,
      reason: 'error',
      message: 'boom',
    });
  });

  it('still succeeds when the post-write stat fails', async () => {
    const fs = makeFs({});
    fs.stat = vi.fn(async () => {
      throw new Error('gone');
    });
    expect(await saveMergeResult('x', 'utf-8', '/o', 1, fs)).toEqual({ ok: true });
  });
});
