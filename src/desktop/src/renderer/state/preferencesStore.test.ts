import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  createPreferencesStore,
  loadInitialPreferences,
} from './preferencesStore.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    snapshot: (): Record<string, string> => Object.fromEntries(data),
  };
}

describe('loadInitialPreferences', () => {
  it('returns the defaults when storage has nothing', () => {
    expect(loadInitialPreferences({ storage: memoryStorage() })).toEqual(
      DEFAULT_PREFERENCES,
    );
  });

  it('reads back a persisted snapshot', () => {
    const storage = memoryStorage({
      [PREFERENCES_STORAGE_KEY]: JSON.stringify({ confirmOverwriteOnCopy: false }),
    });
    expect(loadInitialPreferences({ storage })).toEqual({ confirmOverwriteOnCopy: false });
  });

  it('falls back to defaults when the persisted JSON is corrupt', () => {
    const storage = memoryStorage({ [PREFERENCES_STORAGE_KEY]: 'not-json' });
    expect(loadInitialPreferences({ storage })).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('createPreferencesStore', () => {
  it('persists when setConfirmOverwriteOnCopy is called', () => {
    const storage = memoryStorage();
    const useStore = createPreferencesStore({ storage });
    useStore.getState().setConfirmOverwriteOnCopy(false);
    expect(useStore.getState().confirmOverwriteOnCopy).toBe(false);
    expect(storage.snapshot()[PREFERENCES_STORAGE_KEY]).toBe(
      JSON.stringify({ confirmOverwriteOnCopy: false }),
    );
  });

  it('reset() restores the defaults and persists them', () => {
    const storage = memoryStorage({
      [PREFERENCES_STORAGE_KEY]: JSON.stringify({ confirmOverwriteOnCopy: false }),
    });
    const useStore = createPreferencesStore({ storage });
    useStore.getState().reset();
    expect(useStore.getState().confirmOverwriteOnCopy).toBe(true);
    expect(storage.snapshot()[PREFERENCES_STORAGE_KEY]).toBe(
      JSON.stringify(DEFAULT_PREFERENCES),
    );
  });

  it('setPreferences replaces the entire snapshot', () => {
    const storage = memoryStorage();
    const useStore = createPreferencesStore({ storage });
    useStore.getState().setPreferences({ confirmOverwriteOnCopy: false });
    expect(useStore.getState().confirmOverwriteOnCopy).toBe(false);
  });
});
