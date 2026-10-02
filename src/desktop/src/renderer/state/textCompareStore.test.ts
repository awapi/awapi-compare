import { describe, expect, it } from 'vitest';
import {
  TEXT_COMPARE_STORAGE_KEY,
  createTextCompareStore,
  loadTextCompareOptions,
} from './textCompareStore.js';
import { DEFAULT_TEXT_COMPARE_OPTIONS } from '../textCompare.js';

function memoryStorage(seed?: string) {
  const data = new Map<string, string>();
  if (seed !== undefined) data.set(TEXT_COMPARE_STORAGE_KEY, seed);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe('textCompareStore', () => {
  it('starts from defaults without storage', () => {
    const store = createTextCompareStore({ storage: null });
    expect(store.getState().options).toEqual(DEFAULT_TEXT_COMPARE_OPTIONS);
  });

  it('loads and sanitizes persisted options', () => {
    const storage = memoryStorage(JSON.stringify({ ignoreCase: true, wordWrap: 'maybe' }));
    const { options } = createTextCompareStore({ storage }).getState();
    expect(options.ignoreCase).toBe(true);
    expect(options.wordWrap).toBe(false);
  });

  it('falls back to defaults on corrupt JSON', () => {
    expect(loadTextCompareOptions(memoryStorage('{oops'))).toEqual(DEFAULT_TEXT_COMPARE_OPTIONS);
    expect(loadTextCompareOptions(memoryStorage())).toEqual(DEFAULT_TEXT_COMPARE_OPTIONS);
    expect(loadTextCompareOptions(null)).toEqual(DEFAULT_TEXT_COMPARE_OPTIONS);
  });

  it('update merges, persists and reset restores defaults', () => {
    const storage = memoryStorage();
    const store = createTextCompareStore({ storage });
    store.getState().update({ ignoreCase: true, ignorePatterns: ['\\d+'] });
    expect(store.getState().options.ignoreCase).toBe(true);
    expect(JSON.parse(storage.data.get(TEXT_COMPARE_STORAGE_KEY) ?? '{}')).toMatchObject({
      ignoreCase: true,
      ignorePatterns: ['\\d+'],
    });
    store.getState().reset();
    expect(store.getState().options).toEqual(DEFAULT_TEXT_COMPARE_OPTIONS);
  });

  it('survives a storage that throws on write', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    const store = createTextCompareStore({ storage });
    expect(() => store.getState().update({ wordWrap: true })).not.toThrow();
    expect(store.getState().options.wordWrap).toBe(true);
  });
});
