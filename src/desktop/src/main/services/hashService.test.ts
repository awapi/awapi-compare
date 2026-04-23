import { Volume } from 'memfs';
import { describe, expect, it } from 'vitest';

import type { HashFs } from './hashService.js';
import { HashService } from './hashService.js';

function makeFs(tree: Record<string, string>): HashFs {
  const vol = Volume.fromJSON(tree, '/');
  return vol as unknown as HashFs;
}

describe('HashService', () => {
  it('computes SHA-256 of a file (matches known vector for "abc")', async () => {
    const fs = makeFs({ '/f.txt': 'abc' });
    const svc = new HashService(fs);
    const digest = await svc.hash('/f.txt');
    // SHA-256("abc") = ba7816bf...b00361a3...
    expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('produces the same hash for identical contents', async () => {
    const fs = makeFs({ '/a': 'hello world', '/b': 'hello world' });
    const svc = new HashService(fs);
    expect(await svc.hash('/a')).toBe(await svc.hash('/b'));
  });

  it('produces different hashes for different contents', async () => {
    const fs = makeFs({ '/a': 'hello', '/b': 'world' });
    const svc = new HashService(fs);
    expect(await svc.hash('/a')).not.toBe(await svc.hash('/b'));
  });

  it('rejects when the file cannot be opened', async () => {
    const fs = makeFs({ '/a': 'x' });
    const svc = new HashService(fs);
    await expect(svc.hash('/missing')).rejects.toBeDefined();
  });

  it('bytesEqual returns true for identical files and false otherwise', async () => {
    const fs = makeFs({ '/a': 'same', '/b': 'same', '/c': 'diff' });
    const svc = new HashService(fs);
    expect(await svc.bytesEqual('/a', '/b')).toBe(true);
    expect(await svc.bytesEqual('/a', '/c')).toBe(false);
  });
});
