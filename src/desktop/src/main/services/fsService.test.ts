import { Volume } from 'memfs';
import { describe, expect, it, vi } from 'vitest';

import type { FsScanRequest, Rule } from '@awapi/shared';

import { NotImplementedError } from './errors.js';
import { FsService } from './fsService.js';
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
  });
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
    const r = await svc(fs).scan(req({ leftRoot: '/l', rightRoot: '/r', mode: 'thorough' }));
    const p = r.pairs.find((x) => x.relPath === 'a.txt');
    expect(p?.status).toBe('identical');
    expect(p?.leftHash).toBeDefined();
    expect(p?.leftHash).toBe(p?.rightHash);
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
});

describe('FsService deferred methods', () => {
  it('throws NotImplementedError for copy/readChunk/write', () => {
    const s = new FsService();
    expect(() => s.copy({ from: '/a', to: '/b' })).toThrow(NotImplementedError);
    expect(() => s.readChunk({ path: '/a', offset: 0, length: 16 })).toThrow(NotImplementedError);
    expect(() => s.write({ path: '/a', contents: '' })).toThrow(NotImplementedError);
  });

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
