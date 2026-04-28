import { Volume } from 'memfs';
import { describe, expect, it, vi } from 'vitest';

import { mergeDiffOptions, type FsScanRequest, type Rule } from '@awapi/shared';

import { FS_ERROR_EXTERNAL_MODIFICATION, FS_ERROR_FILE_TOO_LARGE, FsCodedError, FsService, type FsIo } from './fsService.js';
import { HashService } from './hashService.js';

function makeFs(tree: Record<string, string | null>): unknown {
  const files: Record<string, string> = {};
  for (const [p, v] of Object.entries(tree)) {
    if (v !== null) files[p] = v;
  }
  const vol = Volume.fromJSON(files, '/');
  for (const [p, v] of Object.entries(tree)) {
    if (v === null) vol.mkdirSync(p, { recursive: true });
  }
  return vol;
}

function svc(fs: unknown): FsService {
  return new FsService({
    scannerOptions: { fs: fs as never },
    hash: new HashService(fs as never),
    io: ioOf(fs),
  });
}

// memfs's `fs.promises` doesn't expose `open`, so we shim it on top of
// the synchronous API. Only the `read` and `close` methods used by
// {@link FsService.readChunk} need to work.
function ioOf(fs: unknown): FsIo {
  const realFs = fs as {
    promises: {
      readFile(p: string): Promise<Uint8Array | Buffer>;
      writeFile(p: string, data: Uint8Array | string, opts?: { encoding?: BufferEncoding | null }): Promise<void>;
      stat(p: string): Promise<{
        size: number;
        mtimeMs: number;
        isFile(): boolean;
        isDirectory(): boolean;
        isSymbolicLink(): boolean;
      }>;
    };
    openSync(p: string, flags: string): number;
    readSync(fd: number, buf: Uint8Array, off: number, len: number, pos: number | null): number;
    closeSync(fd: number): void;
  };
  return {
    readFile: (p) => realFs.promises.readFile(p),
    writeFile: (p, d, o) => realFs.promises.writeFile(p, d, o),
    stat: (p) => realFs.promises.stat(p),
    lstat: (p) =>
      (realFs as unknown as { promises: { lstat(p: string): Promise<{ size: number; mtimeMs: number; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }> } }).promises.lstat(p),
    readdir: (p) =>
      (realFs as unknown as { promises: { readdir(p: string): Promise<string[]> } }).promises.readdir(p),
    mkdir: (p, opts) =>
      (realFs as unknown as { promises: { mkdir(p: string, opts?: { recursive?: boolean }): Promise<unknown> } }).promises
        .mkdir(p, opts)
        .then(() => undefined),
    copyFile: (from, to) =>
      (realFs as unknown as { promises: { copyFile(from: string, to: string): Promise<void> } }).promises.copyFile(from, to),
    rm: (p, opts) =>
      (realFs as unknown as { promises: { rm(p: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> } }).promises.rm(p, opts),
    rename: (from, to) =>
      (realFs as unknown as { promises: { rename(from: string, to: string): Promise<void> } }).promises.rename(from, to),
    open: (p, flags) =>
      Promise.resolve({
        async read(buf: Uint8Array, off: number, len: number, pos: number | null) {
          const fd = realFs.openSync(p, flags);
          try {
            const bytesRead = realFs.readSync(fd, buf, off, len, pos);
            return { bytesRead, buffer: buf };
          } finally {
            realFs.closeSync(fd);
          }
        },
        async close() {
          /* fd is closed inside read() — no-op here. */
        },
      }),
  };
}

function req(
  partial: Partial<FsScanRequest> & Pick<FsScanRequest, 'leftRoot' | 'rightRoot'>,
): FsScanRequest {
  return { mode: 'quick', rules: [], ...partial } as FsScanRequest;
}

describe('FsService.scan', () => {
  it('classifies pairs across both sides in quick mode', async () => {
    const fs = makeFs({
      '/left/a.txt': 'hello',
      '/left/only-left.txt': 'x',
      '/right/a.txt': 'hello',
      '/right/only-right.txt': 'y',
    });
    const r = await svc(fs).scan(req({ leftRoot: '/left', rightRoot: '/right' }));
    const byPath = new Map(r.pairs.map((p) => [p.relPath, p]));

    expect(byPath.get('a.txt')?.status).toBe('identical');
    expect(byPath.get('only-left.txt')?.status).toBe('left-only');
    expect(byPath.get('only-right.txt')?.status).toBe('right-only');
    expect(typeof r.durationMs).toBe('number');
  });

  it('uses SHA-256 in thorough mode and reports hashes on identical files', async () => {
    const fs = makeFs({ '/l/a.txt': 'same', '/r/a.txt': 'same' });
    // Disable the attribute-skip optimisation so the engine actually
    // reaches the hash branch and reports the digests.
    const r = await svc(fs).scan(
      req({
        leftRoot: '/l',
        rightRoot: '/r',
        mode: 'thorough',
        diffOptions: mergeDiffOptions({
          content: { skipWhenAttributesMatch: false },
        }),
      }),
    );
    const p = r.pairs.find((x) => x.relPath === 'a.txt');
    expect(p?.status).toBe('identical');
    expect(p?.leftHash).toBeDefined();
    expect(p?.leftHash).toBe(p?.rightHash);
  });

  it('skips content read in thorough mode when attributes already match (default)', async () => {
    const fs = makeFs({ '/l/a.txt': 'same', '/r/a.txt': 'same' });
    const r = await svc(fs).scan(req({ leftRoot: '/l', rightRoot: '/r', mode: 'thorough' }));
    const p = r.pairs.find((x) => x.relPath === 'a.txt');
    expect(p?.status).toBe('identical');
    // No hashes because the engine short-circuited.
    expect(p?.leftHash).toBeUndefined();
    expect(p?.rightHash).toBeUndefined();
  });

  it('short-circuits on size mismatch without hashing in thorough mode', async () => {
    const fs = makeFs({ '/l/a.txt': 'short', '/r/a.txt': 'way longer' });
    const r = await svc(fs).scan(req({ leftRoot: '/l', rightRoot: '/r', mode: 'thorough' }));
    const p = r.pairs.find((x) => x.relPath === 'a.txt');
    expect(p?.status).toBe('different');
    expect(p?.leftHash).toBeUndefined();
  });

  it('applies exclude rules during scan', async () => {
    const rules: Rule[] = [{ id: '1', kind: 'exclude', pattern: '**/*.log', enabled: true }];
    const fs = makeFs({ '/l/keep.txt': 'a', '/l/drop.log': 'x', '/r/keep.txt': 'a' });
    const r = await svc(fs).scan(req({ leftRoot: '/l', rightRoot: '/r', rules }));
    const paths = r.pairs.map((p) => p.relPath);
    expect(paths).toContain('keep.txt');
    expect(paths).not.toContain('drop.log');
  });

  it('emits scan-progress events for each kept entry', async () => {
    const fs = makeFs({ '/l/a': 'x', '/l/b': 'y', '/r/a': 'x' });
    const s = svc(fs);
    const listener = vi.fn();
    s.onScanProgress(listener);
    await s.scan(req({ leftRoot: '/l', rightRoot: '/r' }));
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('captures per-side scan errors as error pairs', async () => {
    const fs = makeFs({ '/l/a': 'x' });
    const r = await svc(fs).scan(req({ leftRoot: '/l', rightRoot: '/missing' }));
    expect(r.pairs.some((p) => p.status === 'error')).toBe(true);
  });

  it('lists left-only entries when the right root is empty (single-side listing)', async () => {
    const fs = makeFs({
      '/l/a.txt': 'hello',
      '/l/sub/b.txt': 'world',
    });
    const r = await svc(fs).scan(req({ leftRoot: '/l', rightRoot: '' }));
    const byPath = new Map(r.pairs.map((p) => [p.relPath, p]));
    expect(byPath.get('a.txt')?.status).toBe('left-only');
    expect(byPath.get('sub')?.status).toBe('left-only');
    expect(byPath.get('sub/b.txt')?.status).toBe('left-only');
    // Nothing was scanned on the right side, so no error pairs.
    expect(r.pairs.every((p) => p.status !== 'error')).toBe(true);
  });

  it('lists right-only entries when the left root is empty (single-side listing)', async () => {
    const fs = makeFs({ '/r/a.txt': 'hello' });
    const r = await svc(fs).scan(req({ leftRoot: '   ', rightRoot: '/r' }));
    const p = r.pairs.find((x) => x.relPath === 'a.txt');
    expect(p?.status).toBe('right-only');
    expect(p?.left).toBeUndefined();
    expect(p?.right).toBeDefined();
  });
});

describe('FsService.scan — DiffOptions pairing', () => {
  it('case-insensitive pairing matches Foo.txt on the left with foo.txt on the right', async () => {
    const fs = makeFs({ '/l/Foo.txt': 'hello', '/r/foo.txt': 'hello' });
    const r = await svc(fs).scan(
      req({
        leftRoot: '/l',
        rightRoot: '/r',
        diffOptions: mergeDiffOptions({ pairing: { caseSensitive: false } }),
      }),
    );
    const paired = r.pairs.find((p) => p.left && p.right);
    expect(paired).toBeDefined();
    expect(paired?.status).toBe('identical');
  });

  it('case-sensitive pairing (default) reports the same files as left/right-only', async () => {
    const fs = makeFs({ '/l/Foo.txt': 'hello', '/r/foo.txt': 'hello' });
    const r = await svc(fs).scan(req({ leftRoot: '/l', rightRoot: '/r' }));
    const statuses = r.pairs.map((p) => p.status).sort();
    expect(statuses).toEqual(['left-only', 'right-only']);
  });

  it('ignoreExtension pairing matches foo.ts on the left with foo.js on the right', async () => {
    const fs = makeFs({ '/l/foo.ts': 'x', '/r/foo.js': 'x' });
    const r = await svc(fs).scan(
      req({
        leftRoot: '/l',
        rightRoot: '/r',
        diffOptions: mergeDiffOptions({ pairing: { ignoreExtension: true } }),
      }),
    );
    const paired = r.pairs.find((p) => p.left && p.right);
    expect(paired?.left?.name).toBe('foo.ts');
    expect(paired?.right?.name).toBe('foo.js');
  });
});

describe('FsService.read', () => {
  it('returns the file contents plus size and mtime', async () => {
    const fs = makeFs({ '/x.txt': 'hello' });
    const r = await svc(fs).read({ path: '/x.txt' });
    expect(new TextDecoder().decode(r.data)).toBe('hello');
    expect(r.size).toBe(5);
    expect(typeof r.mtimeMs).toBe('number');
  });

  it('rejects with E_FILE_TOO_LARGE when the file exceeds maxBytes', async () => {
    const fs = makeFs({ '/big.bin': 'x'.repeat(2048) });
    await expect(svc(fs).read({ path: '/big.bin', maxBytes: 1024 })).rejects.toMatchObject({
      code: FS_ERROR_FILE_TOO_LARGE,
    });
  });

  it('rejects with E_NOT_FILE on directories', async () => {
    const fs = makeFs({ '/dir': null });
    await expect(svc(fs).read({ path: '/dir' })).rejects.toBeInstanceOf(FsCodedError);
  });
});

describe('FsService.stat', () => {
  it('reports type=file with size and mtime', async () => {
    const fs = makeFs({ '/y.txt': 'abc' });
    const r = await svc(fs).stat({ path: '/y.txt' });
    expect(r.type).toBe('file');
    expect(r.size).toBe(3);
    expect(typeof r.mtimeMs).toBe('number');
  });

  it('reports type=dir for directories', async () => {
    const fs = makeFs({ '/d': null });
    const r = await svc(fs).stat({ path: '/d' });
    expect(r.type).toBe('dir');
  });
});

describe('FsService.write', () => {
  it('writes utf8 text to disk', async () => {
    const fs = makeFs({});
    await svc(fs).write({ path: '/z.txt', contents: 'héllo' });
    const r = await svc(fs).read({ path: '/z.txt' });
    expect(new TextDecoder().decode(r.data)).toBe('héllo');
  });

  it('writes raw bytes when contents is a Uint8Array', async () => {
    const fs = makeFs({});
    await svc(fs).write({
      path: '/bin.dat',
      contents: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
    });
    const r = await svc(fs).read({ path: '/bin.dat' });
    expect(Array.from(r.data)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('rejects with E_EXTERNAL_MODIFICATION when expectedMtimeMs disagrees', async () => {
    const fs = makeFs({ '/m.txt': 'first' });
    const before = await svc(fs).stat({ path: '/m.txt' });
    // Tamper: change mtime via the underlying volume.
    (fs as { utimesSync(p: string, atime: number, mtime: number): void }).utimesSync(
      '/m.txt',
      Date.now() / 1000,
      (before.mtimeMs + 5000) / 1000,
    );
    await expect(
      svc(fs).write({
        path: '/m.txt',
        contents: 'second',
        expectedMtimeMs: before.mtimeMs,
      }),
    ).rejects.toMatchObject({ code: FS_ERROR_EXTERNAL_MODIFICATION });
  });

  it('writes successfully when expectedMtimeMs matches the current mtime', async () => {
    const fs = makeFs({ '/m.txt': 'first' });
    const before = await svc(fs).stat({ path: '/m.txt' });
    await expect(
      svc(fs).write({
        path: '/m.txt',
        contents: 'second',
        expectedMtimeMs: before.mtimeMs,
      }),
    ).resolves.toBeUndefined();
    const after = await svc(fs).read({ path: '/m.txt' });
    expect(new TextDecoder().decode(after.data)).toBe('second');
  });
});

describe('FsService.readChunk', () => {
  it('reads a window of bytes from the requested offset', async () => {
    const fs = makeFs({ '/buf.bin': 'abcdefghij' });
    const r = await svc(fs).readChunk({ path: '/buf.bin', offset: 3, length: 4 });
    expect(new TextDecoder().decode(r)).toBe('defg');
  });

  it('returns a short buffer when reading past EOF', async () => {
    const fs = makeFs({ '/buf.bin': 'abcde' });
    const r = await svc(fs).readChunk({ path: '/buf.bin', offset: 3, length: 16 });
    expect(new TextDecoder().decode(r)).toBe('de');
  });

  it('rejects on negative or non-integer offset/length', async () => {
    const fs = makeFs({ '/buf.bin': 'abc' });
    await expect(svc(fs).readChunk({ path: '/buf.bin', offset: -1, length: 1 })).rejects.toThrow();
    await expect(svc(fs).readChunk({ path: '/buf.bin', offset: 0, length: 0 })).rejects.toThrow();
    await expect(svc(fs).readChunk({ path: '/buf.bin', offset: 0.5, length: 1 })).rejects.toThrow();
  });
});

describe('FsService deferred methods', () => {
  it('dispatches scan-progress events to all listeners until unsubscribed', () => {
    const s = new FsService();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = s.onScanProgress(a);
    s.onScanProgress(b);

    s.emitScanProgress({ scanned: 1 });
    s.emitScanProgress({ scanned: 2, total: 10, currentPath: '/x' });

    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);

    unsubA();
    s.emitScanProgress({ scanned: 3 });
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(3);
  });
});

describe('FsService.copy', () => {
  it('copies a single file when the destination does not exist', async () => {
    const fs = makeFs({ '/src/a.txt': 'hello' });
    const r = await svc(fs).copy({ from: '/src/a.txt', to: '/dst/a.txt' });
    expect(r).toEqual({ copied: 1, skipped: 0, errors: [] });
    const read = await svc(fs).read({ path: '/dst/a.txt' });
    expect(new TextDecoder().decode(read.data)).toBe('hello');
  });

  it('skips an existing destination file when overwrite is false', async () => {
    const fs = makeFs({ '/src/a.txt': 'new', '/dst/a.txt': 'old' });
    const r = await svc(fs).copy({ from: '/src/a.txt', to: '/dst/a.txt' });
    expect(r).toEqual({ copied: 0, skipped: 1, errors: [] });
    const read = await svc(fs).read({ path: '/dst/a.txt' });
    expect(new TextDecoder().decode(read.data)).toBe('old');
  });

  it('overwrites an existing destination file when overwrite is true', async () => {
    const fs = makeFs({ '/src/a.txt': 'new', '/dst/a.txt': 'old' });
    const r = await svc(fs).copy({ from: '/src/a.txt', to: '/dst/a.txt', overwrite: true });
    expect(r).toEqual({ copied: 1, skipped: 0, errors: [] });
    const read = await svc(fs).read({ path: '/dst/a.txt' });
    expect(new TextDecoder().decode(read.data)).toBe('new');
  });

  it('recursively copies a directory tree', async () => {
    const fs = makeFs({
      '/src/a.txt': 'a',
      '/src/sub/b.txt': 'b',
      '/src/sub/deep/c.txt': 'c',
    });
    const r = await svc(fs).copy({ from: '/src', to: '/dst' });
    expect(r.copied).toBe(3);
    expect(r.errors).toEqual([]);
    expect(new TextDecoder().decode((await svc(fs).read({ path: '/dst/sub/deep/c.txt' })).data)).toBe('c');
  });

  it('counts as copied without writing when dryRun is true', async () => {
    const fs = makeFs({ '/src/a.txt': 'a' });
    const r = await svc(fs).copy({ from: '/src/a.txt', to: '/dst/a.txt', dryRun: true });
    expect(r.copied).toBe(1);
    await expect(svc(fs).stat({ path: '/dst/a.txt' })).rejects.toBeDefined();
  });

  it('records an error entry when the source does not exist', async () => {
    const fs = makeFs({});
    const r = await svc(fs).copy({ from: '/missing.txt', to: '/dst.txt' });
    expect(r.copied).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.path).toBe('/missing.txt');
  });
});

describe('FsService.rm', () => {
  it('deletes a single file', async () => {
    const fs = makeFs({ '/a.txt': 'hi' });
    const r = await svc(fs).rm({ paths: ['/a.txt'] });
    expect(r).toEqual({ deleted: 1, errors: [] });
    await expect(svc(fs).stat({ path: '/a.txt' })).rejects.toBeDefined();
  });

  it('removes a directory recursively', async () => {
    const fs = makeFs({ '/d/x.txt': 'x', '/d/sub/y.txt': 'y' });
    const r = await svc(fs).rm({ paths: ['/d'] });
    expect(r.deleted).toBe(1);
    expect(r.errors).toEqual([]);
    await expect(svc(fs).stat({ path: '/d' })).rejects.toBeDefined();
  });

  it('records errors for missing paths and continues with the rest', async () => {
    const fs = makeFs({ '/keep.txt': 'k' });
    const r = await svc(fs).rm({ paths: ['/missing.txt', '/keep.txt'] });
    expect(r.deleted).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.path).toBe('/missing.txt');
  });

  it('de-duplicates repeated paths and ignores blanks', async () => {
    const fs = makeFs({ '/a.txt': 'a' });
    const r = await svc(fs).rm({ paths: ['/a.txt', '/a.txt', ''] });
    expect(r.deleted).toBe(1);
    expect(r.errors).toEqual([]);
  });
});

describe('FsService.rename', () => {
  it('renames a file in place', async () => {
    const fs = makeFs({ '/a.txt': 'hi' });
    await svc(fs).rename({ from: '/a.txt', to: '/b.txt' });
    const after = await svc(fs).read({ path: '/b.txt' });
    expect(new TextDecoder().decode(after.data)).toBe('hi');
  });

  it('rejects when the destination already exists', async () => {
    const fs = makeFs({ '/a.txt': 'a', '/b.txt': 'b' });
    await expect(
      svc(fs).rename({ from: '/a.txt', to: '/b.txt' }),
    ).rejects.toBeInstanceOf(FsCodedError);
  });

  it('is a no-op when from === to', async () => {
    const fs = makeFs({ '/a.txt': 'a' });
    await expect(
      svc(fs).rename({ from: '/a.txt', to: '/a.txt' }),
    ).resolves.toBeUndefined();
  });
});
