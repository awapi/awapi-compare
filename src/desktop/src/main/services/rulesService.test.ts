import { describe, expect, it, vi } from 'vitest';

import type { Rule } from '@awapi/shared';

import { RulesService, type RulesFs } from './rulesService.js';

const rule = (id: string, partial: Partial<Rule> = {}): Rule => ({
  id,
  kind: 'exclude',
  pattern: '*.log',
  enabled: true,
  ...partial,
});

function memFs(initial: Record<string, string> = {}): RulesFs & {
  written(): Record<string, string>;
} {
  const files = new Map(Object.entries(initial));
  return {
    readFile: vi.fn(async (path: string) => {
      const v = files.get(path);
      if (v === undefined) {
        const err: NodeJS.ErrnoException = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return v;
    }),
    writeFile: vi.fn(async (path: string, contents: string) => {
      files.set(path, contents);
    }),
    mkdir: vi.fn(async () => undefined),
    written: () => Object.fromEntries(files),
  };
}

describe('RulesService — in-memory mode', () => {
  it('returns an empty list by default', async () => {
    await expect(new RulesService().get()).resolves.toEqual([]);
  });

  it('round-trips rules and returns defensive copies', async () => {
    const svc = new RulesService();
    const input = [rule('r1')];
    await svc.set(input);

    const out = await svc.get();
    expect(out).toEqual(input);

    out.push(rule('r2'));
    expect(await svc.get()).toHaveLength(1);
  });

  it('flush() is a no-op when no filePath is configured', async () => {
    await expect(new RulesService().flush()).resolves.toBeUndefined();
  });
});

describe('RulesService — disk persistence', () => {
  it('loads an empty rule set when the file does not exist', async () => {
    const fs = memFs();
    const svc = new RulesService({ filePath: '/u/rules.json', fs, dirPath: '/u' });
    await expect(svc.get()).resolves.toEqual([]);
  });

  it('persists set() calls to disk and round-trips on reload', async () => {
    const fs = memFs();
    const svc = new RulesService({ filePath: '/u/rules.json', fs, dirPath: '/u' });

    const input = [rule('r1', { pattern: '**/*.log' }), rule('r2', { pattern: 'build/**' })];
    await svc.set(input);

    expect(fs.mkdir).toHaveBeenCalledWith('/u', { recursive: true });
    const written = JSON.parse(fs.written()['/u/rules.json'] ?? '{}');
    expect(written).toEqual({ version: 1, rules: input });

    // A fresh service instance reading the same file should see the same rules.
    const svc2 = new RulesService({ filePath: '/u/rules.json', fs, dirPath: '/u' });
    await expect(svc2.get()).resolves.toEqual(input);
  });

  it('tolerates a corrupt JSON file by starting empty', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fs = memFs({ '/u/rules.json': 'not valid json' });
    const svc = new RulesService({ filePath: '/u/rules.json', fs, dirPath: '/u' });
    await expect(svc.get()).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops malformed entries when normalising disk contents', async () => {
    const fs = memFs({
      '/u/rules.json': JSON.stringify({
        version: 1,
        rules: [
          rule('good'),
          { id: 5, kind: 'exclude', pattern: 'x', enabled: true }, // bad id
          { id: 'no-kind', pattern: 'x', enabled: true }, // missing kind
          null,
        ],
      }),
    });
    const svc = new RulesService({ filePath: '/u/rules.json', fs });
    const out = await svc.get();
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('good');
  });

  it('also accepts a bare-array file for forward-compat tooling', async () => {
    const fs = memFs({
      '/u/rules.json': JSON.stringify([rule('r1')]),
    });
    const svc = new RulesService({ filePath: '/u/rules.json', fs });
    await expect(svc.get()).resolves.toHaveLength(1);
  });
});

describe('RulesService.test (live preview helper)', () => {
  it('evaluates samples against a rule set without touching state', async () => {
    const svc = new RulesService();
    await svc.set([rule('r1', { pattern: '**/*.log' })]);

    const res = svc.test({
      rules: [rule('r2', { pattern: '**/*.tmp' })],
      samples: [{ relPath: 'a.tmp' }, { relPath: 'a.log' }, { relPath: 'a.txt' }],
    });
    expect(res.verdicts).toEqual(['excluded', 'kept', 'kept']);

    // The persisted rule set is unchanged.
    expect(await svc.get()).toEqual([rule('r1', { pattern: '**/*.log' })]);
  });
});
