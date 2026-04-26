import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useFileDiffData } from './useFileDiffData.js';

interface FakeFiles {
  [path: string]: { data: Uint8Array; mtimeMs: number };
}

function makeFsApi(files: FakeFiles) {
  return {
    async stat({ path }: { path: string }) {
      const f = files[path];
      if (!f) throw new Error('ENOENT');
      return { size: f.data.length, mtimeMs: f.mtimeMs, type: 'file' };
    },
    async read({ path }: { path: string }) {
      const f = files[path];
      if (!f) throw new Error('ENOENT');
      return { data: f.data, size: f.data.length, mtimeMs: f.mtimeMs };
    },
  };
}

describe('useFileDiffData', () => {
  it('loads both sides and decodes UTF-8 text', async () => {
    const fsApi = makeFsApi({
      '/a.txt': { data: new TextEncoder().encode('alpha'), mtimeMs: 1 },
      '/b.txt': { data: new TextEncoder().encode('beta'), mtimeMs: 2 },
    });
    const { result } = renderHook(() =>
      useFileDiffData({ leftPath: '/a.txt', rightPath: '/b.txt', fsApi }),
    );
    await waitFor(() => expect(result.current.kind).toBe('text'));
    await waitFor(() => expect(result.current.left.text).toBe('alpha'));
    expect(result.current.right.text).toBe('beta');
  });

  it('blocks on the unconfirmed gate for large files', async () => {
    const big = new Uint8Array(6 * 1024 * 1024); // 6 MiB > LARGE_FILE_BYTES (5 MiB)
    const fsApi = makeFsApi({
      '/big.bin': { data: big, mtimeMs: 1 },
    });
    const { result } = renderHook(() =>
      useFileDiffData({ leftPath: '/big.bin', rightPath: null, fsApi }),
    );
    await waitFor(() => expect(result.current.left.state).toBe('unconfirmed'));
    await act(async () => {
      result.current.confirmLarge();
    });
    await waitFor(() => expect(result.current.left.state).toBe('ready'));
  });

  it('marks errors when stat fails', async () => {
    const fsApi = makeFsApi({});
    const { result } = renderHook(() =>
      useFileDiffData({ leftPath: '/missing', rightPath: null, fsApi }),
    );
    await waitFor(() => expect(result.current.left.state).toBe('error'));
    expect(result.current.left.error).toMatch(/ENOENT/);
  });
});
