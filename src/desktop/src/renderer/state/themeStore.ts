import { create } from 'zustand';

export type ThemeName = 'dark' | 'light';

const STORAGE_KEY = 'awapi.theme';

export interface ThemeState {
  theme: ThemeName;
  setTheme(theme: ThemeName): void;
  toggleTheme(): void;
}

export interface CreateThemeStoreOptions {
  /** Storage backend (defaults to `window.localStorage` when present). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Initial theme override. */
  initial?: ThemeName;
  /** Detect OS preference. Defaults to a `matchMedia` probe. */
  systemPrefersDark?: () => boolean;
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof globalThis.localStorage === 'undefined') return null;
  return globalThis.localStorage;
}

function defaultSystemPrefersDark(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return true;
  return globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
}

function isThemeName(value: unknown): value is ThemeName {
  return value === 'dark' || value === 'light';
}

/**
 * Load the persisted theme. Falls back to OS preference, then dark.
 * Pure with respect to the injected dependencies — safe to test.
 */
export function loadInitialTheme(opts: CreateThemeStoreOptions = {}): ThemeName {
  const {
    storage = defaultStorage(),
    initial,
    systemPrefersDark = defaultSystemPrefersDark,
  } = opts;
  if (initial) return initial;
  const stored = storage?.getItem(STORAGE_KEY);
  if (isThemeName(stored)) return stored;
  return systemPrefersDark() ? 'dark' : 'light';
}

export function createThemeStore(opts: CreateThemeStoreOptions = {}) {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const persist = (theme: ThemeName): void => {
    storage?.setItem(STORAGE_KEY, theme);
  };
  const initial = loadInitialTheme(opts);

  return create<ThemeState>((set, get) => ({
    theme: initial,
    setTheme: (theme) => {
      persist(theme);
      set({ theme });
    },
    toggleTheme: () => {
      const next: ThemeName = get().theme === 'dark' ? 'light' : 'dark';
      persist(next);
      set({ theme: next });
    },
  }));
}

export type ThemeStore = ReturnType<typeof createThemeStore>;
export const THEME_STORAGE_KEY = STORAGE_KEY;
