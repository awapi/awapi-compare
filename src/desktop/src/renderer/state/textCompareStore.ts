import { create } from 'zustand';
import {
  DEFAULT_TEXT_COMPARE_OPTIONS,
  sanitizeTextCompareOptions,
  type TextCompareOptions,
} from '../textCompare.js';

/**
 * Global text-compare view options (ignore whitespace / case / regex,
 * inline vs side-by-side, word wrap). Shared by every file-diff tab and
 * persisted to {@link Storage} so the choice survives restarts.
 */
export interface TextCompareState {
  options: TextCompareOptions;
  /** Shallow-merge `patch` into the options. */
  update(patch: Partial<TextCompareOptions>): void;
  reset(): void;
}

export interface CreateTextCompareStoreOptions {
  /** Storage backend (defaults to `window.localStorage` when present). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

const STORAGE_KEY = 'awapi.textCompare';

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof globalThis.localStorage === 'undefined') return null;
  return globalThis.localStorage;
}

export function loadTextCompareOptions(
  storage: Pick<Storage, 'getItem'> | null,
): TextCompareOptions {
  const fresh = (): TextCompareOptions => ({ ...DEFAULT_TEXT_COMPARE_OPTIONS, ignorePatterns: [] });
  if (!storage) return fresh();
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return fresh();
  try {
    return sanitizeTextCompareOptions(JSON.parse(raw));
  } catch {
    return fresh();
  }
}

export function createTextCompareStore(opts: CreateTextCompareStoreOptions = {}) {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const persist = (next: TextCompareOptions): void => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Quota / privacy-mode failures must not break the UI.
    }
  };

  return create<TextCompareState>((set, get) => ({
    options: loadTextCompareOptions(storage),
    update: (patch) => {
      const next = sanitizeTextCompareOptions({ ...get().options, ...patch });
      persist(next);
      set({ options: next });
    },
    reset: () => {
      const next = sanitizeTextCompareOptions(undefined);
      persist(next);
      set({ options: next });
    },
  }));
}

export type TextCompareStore = ReturnType<typeof createTextCompareStore>;
export const TEXT_COMPARE_STORAGE_KEY = STORAGE_KEY;
