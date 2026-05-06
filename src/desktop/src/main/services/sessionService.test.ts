import { describe, expect, it } from 'vitest';

import type { Session } from '@awapi/shared';

import type { SessionFs } from './sessionService.js';
import { SessionService } from './sessionService.js';

const session = (id: string, updatedAt = 1): Session => ({
  id,
  leftRoot: `/a/${id}`,
  rightRoot: `/b/${id}`,
  mode: 'quick',
  rules: [],
  createdAt: 1,
  updatedAt,
});

describe('SessionService (in-memory)', () => {
  it('save/load/list round-trip with defensive copies', async () => {
    const svc = new SessionService();
    expect(await svc.list()).toEqual([]);
    expect(await svc.load('missing')).toBeNull();

    const s = session('s1');
    await svc.save(s);

    const loaded = await svc.load('s1');
    expect(loaded).toEqual(s);
    loaded!.leftRoot = '/tampered';
    // Mutating the loaded copy must not affect storage.
    expect((await svc.load('s1'))!.leftRoot).toBe('/a/s1');

    await svc.save(session('s2'));
    const list = await svc.list();
    expect(list.map((x) => x.id).sort()).toEqual(['s1', 's2']);
  });

  it('flush() is a no-op', async () => {
    const svc = new SessionService();
    await expect(svc.flush()).resolves.toBeUndefined();
  });
});

describe('SessionService (disk)', () => {
  function makeFakeFs(): { fs: SessionFs; files: Map<string, string> } {
    const files = new Map<string, string>();
    const fs: SessionFs = {
      readFile: async (path) => {
        const v = files.get(path);
        if (v === undefined) {
          const err = Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
          throw err;
        }
        return v;
      },
      writeFile: async (path, contents) => {
        files.set(path, contents);
      },
      mkdir: async () => undefined,
      readdir: async (dir) =>
        [...files.keys()]
          .filter((p) => p.startsWith(dir + '/'))
          .map((p) => p.slice(dir.length + 1)),
      unlink: async (path) => {
        files.delete(path);
      },
    };
    return { fs, files };
  }

  it('save writes JSON to disk and list reads it back', async () => {
    const { fs, files } = makeFakeFs();
    const svc = new SessionService({ dirPath: '/sessions', fs });

    const s = session('abc');
    await svc.save(s);

    expect(files.has('/sessions/abc.json')).toBe(true);
    expect(JSON.parse(files.get('/sessions/abc.json')!)).toEqual(s);

    // A second instance with the same fs should read from disk.
    const svc2 = new SessionService({ dirPath: '/sessions', fs });
    expect(await svc2.load('abc')).toEqual(s);
    expect(await svc2.list()).toEqual([s]);
  });

  it('list skips non-JSON files and corrupt entries', async () => {
    const { fs, files } = makeFakeFs();
    const svc = new SessionService({ dirPath: '/sessions', fs });

    await svc.save(session('ok'));
    files.set('/sessions/readme.txt', 'not json');
    files.set('/sessions/broken.json', '{bad json');

    const list = await svc.list();
    expect(list.map((s) => s.id)).toEqual(['ok']);
  });

  it('load returns null for missing file', async () => {
    const { fs } = makeFakeFs();
    const svc = new SessionService({ dirPath: '/sessions', fs });
    expect(await svc.load('nope')).toBeNull();
  });

  it('list returns in-memory sessions when readdir fails', async () => {
    const { fs } = makeFakeFs();
    const svc = new SessionService({ dirPath: '/missing-dir', fs });
    await svc.save(session('m1'));
    // readdir will throw for the missing dir; should fall back to in-memory map
    const list = await svc.list();
    expect(list.map((s) => s.id)).toEqual(['m1']);
  });

  it('prunes to 10 sessions, keeping the most recent by updatedAt', async () => {
    const { fs, files } = makeFakeFs();
    const svc = new SessionService({ dirPath: '/sessions', fs });

    // Save 11 sessions with distinct updatedAt timestamps.
    for (let i = 1; i <= 11; i++) {
      await svc.save(session(`s${i}`, i));
    }

    const list = await svc.list();
    expect(list).toHaveLength(10);
    // s1 is the oldest (updatedAt=1) and should have been pruned.
    expect(list.map((s) => s.id)).not.toContain('s1');
    expect(files.has('/sessions/s1.json')).toBe(false);
  });
});
