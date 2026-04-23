import { describe, expect, it } from 'vitest';
import {
  createThemeStore,
  loadInitialTheme,
  THEME_STORAGE_KEY,
} from './themeStore.js';

function memStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    snapshot: () => Object.fromEntries(data),
  };
}

describe('loadInitialTheme', () => {
  it('honours an explicit initial value above all else', () => {
    expect(
      loadInitialTheme({
        initial: 'light',
        storage: memStorage({ [THEME_STORAGE_KEY]: 'dark' }),
        systemPrefersDark: () => true,
      }),
    ).toBe('light');
  });

  it('returns persisted value when present and valid', () => {
    expect(
      loadInitialTheme({
        storage: memStorage({ [THEME_STORAGE_KEY]: 'light' }),
        systemPrefersDark: () => true,
      }),
    ).toBe('light');
  });

  it('ignores invalid persisted value and falls back to OS preference', () => {
    expect(
      loadInitialTheme({
        storage: memStorage({ [THEME_STORAGE_KEY]: 'plaid' }),
        systemPrefersDark: () => false,
      }),
    ).toBe('light');
  });

  it('falls back to OS preference when nothing persisted', () => {
    expect(
      loadInitialTheme({ storage: memStorage(), systemPrefersDark: () => true }),
    ).toBe('dark');
    expect(
      loadInitialTheme({ storage: memStorage(), systemPrefersDark: () => false }),
    ).toBe('light');
  });

  it('handles missing storage by using OS preference', () => {
    expect(loadInitialTheme({ storage: null, systemPrefersDark: () => true })).toBe(
      'dark',
    );
  });
});

describe('themeStore', () => {
  it('seeds from loadInitialTheme', () => {
    const store = createThemeStore({
      storage: memStorage({ [THEME_STORAGE_KEY]: 'light' }),
      systemPrefersDark: () => true,
    });
    expect(store.getState().theme).toBe('light');
  });

  it('setTheme persists and updates state', () => {
    const storage = memStorage();
    const store = createThemeStore({ storage, initial: 'dark' });
    store.getState().setTheme('light');
    expect(store.getState().theme).toBe('light');
    expect(storage.snapshot()[THEME_STORAGE_KEY]).toBe('light');
  });

  it('toggleTheme flips between dark and light and persists', () => {
    const storage = memStorage();
    const store = createThemeStore({ storage, initial: 'dark' });
    store.getState().toggleTheme();
    expect(store.getState().theme).toBe('light');
    expect(storage.snapshot()[THEME_STORAGE_KEY]).toBe('light');
    store.getState().toggleTheme();
    expect(store.getState().theme).toBe('dark');
    expect(storage.snapshot()[THEME_STORAGE_KEY]).toBe('dark');
  });

  it('does not throw when storage is null', () => {
    const store = createThemeStore({ storage: null, initial: 'dark' });
    expect(() => store.getState().setTheme('light')).not.toThrow();
    expect(store.getState().theme).toBe('light');
  });
});
