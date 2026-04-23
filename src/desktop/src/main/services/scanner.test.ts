import { Volume } from 'memfs';
import { describe, expect, it } from 'vitest';

import type { ScanItem, ScannerFs } from './scanner.js';
import { scan, toPosix } from './scanner.js';

function makeFs(tree: Record<string, string | null>): ScannerFs {
  // `tree`: record of absolute path -> contents. `null` marks a directory.
  const files: Record<string, string> = {};
  for (const [p, v] of Object.entries(tree)) {
    if (v !== null) files[p] = v;
  }
  const vol = Volume.fromJSON(files, '/');
  for (const [p, v] of Object.entries(tree)) {
    if (v === null) vol.mkdirSync(p, { recursive: true });
  }
  return vol as unknown as ScannerFs;
}

async function collect(iter: AsyncGenerator<ScanItem>): Promise<ScanItem[]> {
  const out: ScanItem[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('scanner', () => {
  it('walks a tree and yields entries in deterministic order', async () => {
    const fs = makeFs({
      '/root/a.txt': 'aa',
      '/root/sub/b.txt': 'bbb',
      '/root/sub/c.bin': 'cccc',
    });

    const items = await collect(scan('/root', { fs }));
    const rel = items.filter((i) => i.kind === 'entry').map((i) => i.kind === 'entry' && i.entry.relPath);

    expect(rel).toEqual(['a.txt', 'sub', 'sub/b.txt', 'sub/c.bin']);
  });

  it('captures file metadata (size, type)', async () => {
    const fs = makeFs({ '/root/a.txt': 'hello' });
    const items = await collect(scan('/root', { fs }));
    const file = items.find((i) => i.kind === 'entry' && i.entry.name === 'a.txt');
    expect(file?.kind).toBe('entry');
    if (file?.kind === 'entry') {
      expect(file.entry.type).toBe('file');
      expect(file.entry.size).toBe(5);
    }
  });

  it('emits an error when readdir fails at the root', async () => {
    const fs = makeFs({ '/root/a.txt': 'x' });
    // Point at a path that does not exist.
    const items = await collect(scan('/does-not-exist', { fs }));
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('error');
  });

  it('handles empty directories', async () => {
    const fs = makeFs({ '/root/empty': null, '/root/a.txt': 'x' });
    const items = await collect(scan('/root', { fs }));
    const names = items.flatMap((i) => (i.kind === 'entry' ? [i.entry.relPath] : []));
    expect(names).toContain('empty');
    expect(names).toContain('a.txt');
  });

  it('does not follow symlinks by default; reports them as symlink entries', async () => {
    const fs = makeFs({ '/root/a.txt': 'x', '/other/c.txt': 'y' });
    (fs as unknown as { symlinkSync: (t: string, p: string) => void }).symlinkSync('/other', '/root/link');

    const items = await collect(scan('/root', { fs }));
    const symlinks = items.filter((i) => i.kind === 'entry' && i.entry.type === 'symlink');
    expect(symlinks).toHaveLength(1);
    // Should NOT descend into /other.
    expect(items.some((i) => i.kind === 'entry' && i.entry.relPath === 'link/c.txt')).toBe(false);
  });

  it('follows symlinks when followSymlinks is true and guards cycles', async () => {
    const fs = makeFs({ '/root/a.txt': 'x' });
    const vol = fs as unknown as { symlinkSync: (t: string, p: string) => void };
    // Create a cycle: /root/loop -> /root
    vol.symlinkSync('/root', '/root/loop');

    const items = await collect(scan('/root', { fs, followSymlinks: true }));
    const cycleErr = items.find((i) => i.kind === 'error' && i.message.includes('cycle'));
    expect(cycleErr).toBeDefined();
  });

  it('follows symlinks to files', async () => {
    const fs = makeFs({ '/root/a.txt': 'x', '/other/target.bin': 'z' });
    (fs as unknown as { symlinkSync: (t: string, p: string) => void }).symlinkSync(
      '/other/target.bin',
      '/root/link-to-file',
    );

    const items = await collect(scan('/root', { fs, followSymlinks: true }));
    const followed = items.find(
      (i) => i.kind === 'entry' && i.entry.relPath === 'link-to-file' && i.entry.type === 'file',
    );
    expect(followed).toBeDefined();
  });

  it('simulates a reasonably sized tree without piling everything in memory at once', async () => {
    const entries: Record<string, string | null> = {};
    for (let i = 0; i < 200; i++) {
      entries[`/root/d${i % 10}/f${i}.txt`] = `x${i}`;
    }
    const fs = makeFs(entries);
    let count = 0;
    for await (const item of scan('/root', { fs })) {
      if (item.kind === 'entry' && item.entry.type === 'file') count++;
    }
    expect(count).toBe(200);
  });
});

describe('toPosix', () => {
  it('converts backslashes to forward slashes', () => {
    expect(toPosix('a\\b\\c')).toBe('a/b/c');
  });
  it('is a no-op for POSIX paths', () => {
    expect(toPosix('a/b/c')).toBe('a/b/c');
  });
});
