import { describe, expect, it } from 'vitest';

import type { Session } from '@awapi/shared';

import { NotImplementedError } from './errors.js';
import { SessionService } from './sessionService.js';

const session = (id: string): Session => ({
  id,
  leftRoot: '/a',
  rightRoot: '/b',
  mode: 'quick',
  rules: [],
  createdAt: 1,
  updatedAt: 1,
});

describe('SessionService', () => {
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
    expect((await svc.load('s1'))!.leftRoot).toBe('/a');

    await svc.save(session('s2'));
    const list = await svc.list();
    expect(list.map((x) => x.id).sort()).toEqual(['s1', 's2']);
  });

  it('flush() is deferred', () => {
    expect(() => new SessionService().flush()).toThrow(NotImplementedError);
  });
});
