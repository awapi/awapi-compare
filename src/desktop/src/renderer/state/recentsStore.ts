import { create } from 'zustand';

/**
 * Recent paths the user has typed / picked into the Left/Right path
 * inputs of the toolbar. Tracked per-kind (folder vs file) and
 * per-side (left vs right) so each combobox surfaces only the values
 * that make sense for it. Persisted to {@link Storage} (defaults to
 * `window.localStorage`) so the lists survive app restarts.
 */
export type RecentsKind = 'folder' | 'file';
export type RecentsSide = 'left' | 'right';

/** Maximum number of entries kept per (kind, side) bucket. */
export const RECENTS_LIMIT = 15;

type BucketKey = `${RecentsKind}:${RecentsSide}`;
type RecentsMap = Record<BucketKey, string[]>;

const EMPTY_MAP: RecentsMap = Object.freeze({
  'folder:left': [],
  'folder:right': [],
  'file:left': [],
  'file:right': [],
}) as RecentsMap;

function bucketKey(kind: RecentsKind, side: RecentsSide): BucketKey {
  return `${kind}:${side}` as BucketKey;
}

export interface RecentsState {
  recents: RecentsMap;
  /**
   * Add `value` to the front of the (kind, side) bucket. Empty / blank
   * values are ignored. If the value already exists in the bucket it
   * is moved to the front instead of duplicated. The bucket is
   * truncated to {@link RECENTS_LIMIT} entries.
   */
  add(kind: RecentsKind, side: RecentsSide, value: string): void;
  /** Read the current bucket as a frozen array. */
  get(kind: RecentsKind, side: RecentsSide): readonly string[];
  /** Clear a single bucket (used by tests). */
  clear(kind: RecentsKind, side: RecentsSide): void;
  /** Clear every bucket. */
  reset(): void;
}

export interface CreateRecentsStoreOptions {
  /** Storage backend (defaults to `window.localStorage` when present). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Initial bucket override (skips the storage probe). */
  initial?: Partial<RecentsMap>;
}

const STORAGE_KEY = 'awapi.recents';
export const RECENTS_STORAGE_KEY = STORAGE_KEY;

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof globalThis.localStorage === 'undefined') return null;
  return globalThis.localStorage;
}

function sanitize(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= RECENTS_LIMIT) break;
  }
  return out;
}

export function loadInitialRecents(
  opts: CreateRecentsStoreOptions = {},
): RecentsMap {
  const merged: RecentsMap = {
    'folder:left': [...(opts.initial?.['folder:left'] ?? [])],
    'folder:right': [...(opts.initial?.['folder:right'] ?? [])],
    'file:left': [...(opts.initial?.['file:left'] ?? [])],
    'file:right': [...(opts.initial?.['file:right'] ?? [])],
  };
  for (const k of Object.keys(merged) as BucketKey[]) {
    merged[k] = sanitize(merged[k]);
  }
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  if (!storage) return merged;
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return merged;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<BucketKey, unknown>>;
    for (const k of Object.keys(merged) as BucketKey[]) {
      const fromStorage = sanitize(parsed[k]);
      if (fromStorage.length > 0) merged[k] = fromStorage;
    }
  } catch {
    /* fall through with defaults */
  }
  return merged;
}

export function createRecentsStore(opts: CreateRecentsStoreOptions = {}) {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const persist = (next: RecentsMap): void => {
    storage?.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  return create<RecentsState>((set, getState) => ({
    recents: loadInitialRecents(opts),

    add: (kind, side, value) => {
      const trimmed = (value ?? '').trim();
      if (!trimmed) return;
      const key = bucketKey(kind, side);
      const current = getState().recents[key];
      const filtered = current.filter((v) => v !== trimmed);
      const nextList = [trimmed, ...filtered].slice(0, RECENTS_LIMIT);
      const nextMap: RecentsMap = { ...getState().recents, [key]: nextList };
      persist(nextMap);
      set({ recents: nextMap });
    },

    get: (kind, side) => getState().recents[bucketKey(kind, side)],

    clear: (kind, side) => {
      const key = bucketKey(kind, side);
      const nextMap: RecentsMap = { ...getState().recents, [key]: [] };
      persist(nextMap);
      set({ recents: nextMap });
    },

    reset: () => {
      const nextMap: RecentsMap = {
        'folder:left': [],
        'folder:right': [],
        'file:left': [],
        'file:right': [],
      };
      persist(nextMap);
      set({ recents: nextMap });
    },
  }));
}

export type RecentsStore = ReturnType<typeof createRecentsStore>;

/** Re-exported empty map for tests / callers that need a default. */
export const EMPTY_RECENTS: RecentsMap = EMPTY_MAP;
