import { create } from 'zustand';

/**
 * User preferences persisted to {@link Storage} (defaults to
 * `window.localStorage`). Currently scoped to the small set of UI
 * decisions the user can choose to remember from inline confirmation
 * dialogs (e.g. "Don't ask again before overwriting on copy"). New
 * keys should be added with explicit defaults so missing values stay
 * backwards-compatible.
 */
export interface Preferences {
  /**
   * When `true`, the renderer asks before overwriting an existing
   * file via Copy → Right / Copy ← Left. When `false`, copies
   * proceed silently (the user can re-enable the prompt from the
   * Preferences dialog at any time).
   */
  confirmOverwriteOnCopy: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  confirmOverwriteOnCopy: true,
});

export interface PreferencesState extends Preferences {
  setConfirmOverwriteOnCopy(value: boolean): void;
  /** Replace all preferences at once (used by the Preferences dialog). */
  setPreferences(next: Preferences): void;
  /** Restore every preference to its default. */
  reset(): void;
}

export interface CreatePreferencesStoreOptions {
  /** Storage backend (defaults to `window.localStorage` when present). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Initial preferences override (skips the storage probe). */
  initial?: Partial<Preferences>;
}

const STORAGE_KEY = 'awapi.preferences';

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof globalThis.localStorage === 'undefined') return null;
  return globalThis.localStorage;
}

/**
 * Read the persisted preferences. Pure with respect to the injected
 * storage so tests can drive it without touching the global.
 */
export function loadInitialPreferences(
  opts: CreatePreferencesStoreOptions = {},
): Preferences {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const merged: Preferences = { ...DEFAULT_PREFERENCES, ...(opts.initial ?? {}) };
  if (!storage) return merged;
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return merged;
  try {
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      confirmOverwriteOnCopy:
        typeof parsed.confirmOverwriteOnCopy === 'boolean'
          ? parsed.confirmOverwriteOnCopy
          : merged.confirmOverwriteOnCopy,
    };
  } catch {
    return merged;
  }
}

export function createPreferencesStore(opts: CreatePreferencesStoreOptions = {}) {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const persist = (prefs: Preferences): void => {
    storage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
  };
  const initial = loadInitialPreferences(opts);

  return create<PreferencesState>((set, get) => ({
    ...initial,

    setConfirmOverwriteOnCopy: (value) => {
      const next: Preferences = {
        ...projectPreferences(get()),
        confirmOverwriteOnCopy: value,
      };
      persist(next);
      set(next);
    },

    setPreferences: (next) => {
      persist(next);
      set(next);
    },

    reset: () => {
      persist(DEFAULT_PREFERENCES);
      set(DEFAULT_PREFERENCES);
    },
  }));
}

function projectPreferences(state: PreferencesState): Preferences {
  return { confirmOverwriteOnCopy: state.confirmOverwriteOnCopy };
}

export type PreferencesStore = ReturnType<typeof createPreferencesStore>;
export const PREFERENCES_STORAGE_KEY = STORAGE_KEY;
