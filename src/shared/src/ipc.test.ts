import { describe, expect, it } from 'vitest';
import { IpcChannel } from './ipc.js';

describe('IpcChannel', () => {
  it('exposes unique string identifiers', () => {
    const values = Object.values(IpcChannel);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(typeof v).toBe('string');
      expect(v).toMatch(/^[a-z]+\.[a-zA-Z]+(\.[a-zA-Z]+)?$/);
    }
  });

  it('groups channels by service prefix', () => {
    const prefixes = new Set(Object.values(IpcChannel).map((c) => c.split('.')[0]));
    expect(prefixes).toEqual(
      new Set(['fs', 'session', 'rules', 'license', 'updater', 'sftp']),
    );
  });
});
