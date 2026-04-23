import { describe, expect, it, vi } from 'vitest';

import {
  createRulesStore,
  DEFAULT_SAMPLE_PATHS,
  previewVerdicts,
} from './rulesStore.js';

describe('rulesStore', () => {
  it('seeds with empty rules and not-loaded state', () => {
    const store = createRulesStore();
    expect(store.getState().rules).toEqual([]);
    expect(store.getState().loaded).toBe(false);
  });

  it('honours initial rules and supports replace + markLoaded', () => {
    const store = createRulesStore({
      initial: [
        { id: 'r1', kind: 'exclude', pattern: '*.log', enabled: true },
      ],
    });
    expect(store.getState().rules).toHaveLength(1);
    store.getState().setRules([]);
    expect(store.getState().rules).toEqual([]);
    expect(store.getState().loaded).toBe(false);
    store.getState().markLoaded();
    expect(store.getState().loaded).toBe(true);
  });

  it('exports a non-empty default sample path list', () => {
    expect(DEFAULT_SAMPLE_PATHS.length).toBeGreaterThan(0);
  });
});

describe('previewVerdicts', () => {
  it('falls back to all-kept when the awapi bridge is unavailable', async () => {
    const orig = (globalThis as { awapi?: unknown }).awapi;
    (globalThis as { awapi?: unknown }).awapi = undefined;
    const verdicts = await previewVerdicts({
      rules: [],
      samples: [{ relPath: 'a' }, { relPath: 'b' }],
    });
    expect(verdicts).toEqual(['kept', 'kept']);
    (globalThis as { awapi?: unknown }).awapi = orig;
  });

  it('delegates to window.awapi.rules.test when present', async () => {
    const orig = (globalThis as { awapi?: unknown }).awapi;
    const test = vi.fn().mockResolvedValue({ verdicts: ['excluded', 'kept'] });
    (globalThis as { awapi?: unknown }).awapi = { rules: { test } };
    const verdicts = await previewVerdicts({
      rules: [{ id: 'r', kind: 'exclude', pattern: '*.log', enabled: true }],
      samples: [{ relPath: 'a.log' }, { relPath: 'a.txt' }],
    });
    expect(verdicts).toEqual(['excluded', 'kept']);
    expect(test).toHaveBeenCalledOnce();
    (globalThis as { awapi?: unknown }).awapi = orig;
  });
});
