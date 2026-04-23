import { describe, expect, it } from 'vitest';

import type { Rule } from '@awapi/shared';

import { NotImplementedError } from './errors.js';
import { RulesService } from './rulesService.js';

const rule = (id: string, pattern: string): Rule => ({
  id,
  kind: 'exclude',
  pattern,
  enabled: true,
});

describe('RulesService', () => {
  it('returns an empty list by default', async () => {
    await expect(new RulesService().get()).resolves.toEqual([]);
  });

  it('round-trips rules and returns defensive copies', async () => {
    const svc = new RulesService();
    const input = [rule('r1', '*.log')];
    await svc.set(input);

    const out = await svc.get();
    expect(out).toEqual(input);

    // Mutations to the returned array must not affect service state.
    out.push(rule('r2', '*.tmp'));
    expect(await svc.get()).toHaveLength(1);
  });

  it('flush() is deferred to Phase 6', () => {
    expect(() => new RulesService().flush()).toThrow(NotImplementedError);
  });
});
