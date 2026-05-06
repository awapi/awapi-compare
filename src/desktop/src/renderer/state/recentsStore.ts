import { create } from 'zustand';

/**
 * Recent paths the user has typed / picked into the Left/Right path
 * inputs of the toolbar. Tracked per-kind (folder vs file) — the same
 * list is shown for both the left and right inputs. Persisted to
 * {@link Storage} (defaults to `window.localStorage`) so the lists
 * survive app restarts.
 */
export type RecentsKind = 'folder' | 'file';

/** Maximum number of entries kept per kind bucket. */
export const RECENTS_LIMIT = 10;

type BucketKey = RecentsKind;
type RecentsMap = Record<BucketKey, string[]>;

const EMPTY_MAP: RecentsMap = Object.freeze({
  folder: [],
  file: [],
}) as RecentsMap;

export interface RecentsState {
  recents: RecentsMap;
  /**
   * Add `value` to the front of the kind bucket. Empty / blank values
   * are ignored. If the value already exists it is moved to the front
   * instead of duplicated. The bucket is truncated to
   * {@link RECENTS_LIMIT} entries.
   */
  add(kind: RecentsKind, value: string): void;
  /** Read the current bucket as a frozen array. */
  get(kind: RecentsKind): readonly string[];
  /** Clear a single bucket (used by tests). */
  clear(kind: RecentsKind): void;
  /** Clear every bucket. */
  reset(): void;
  /** Bulk-load from disk data (called once on startup from IPC). */
  load(data: Record<string, unknown>): void;
}

export interface CreateRecentsStoreOptions {
  /** Storage backend (defaults to `window.localStorage` when present). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Initial bucket override (skips the storage probe). */
  initial?: Partial<RecentsMap>;
  /**
   * Called after every mutation (add/clear/reset) with the updated map.
   * Used by the app-level singleton to sync changes to disk via IPC.
   */
  onSave?: (map: RecentsMap) => void;
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

/**
 * Merges old per-side buckets (e.g. `folder:left`, `folder:right`) with
 * a new unified bucket so data migrates gracefully on first launch after
 * the upgrade.
 */
function mergeOldBuckets(
  direct: unknown,
  left: unknown,
  right: unknown,
): string[] {
  const fromDirect = sanitize(direct);
  if (fromDirect.length > 0) return fromDirect;
  // Interleave left and right preserving approximate recency.
  const l = sanitize(left);
  const r = sanitize(right);
  const seen = new Set<string>();
  const out: string[] = [];
  const max = Math.max(l.length, r.length);
  for (let i = 0; i < max && out.length < RECENTS_LIMIT; i++) {
    if (i < l.length && !seen.has(l[i]!)) {
      seen.add(l[i]!);
      out.push(l[i]!);
    }
    if (i < r.length && !seen.has(r[i]!)) {
      seen.add(r[i]!);
      out.push(r[i]!);
    }
  }
  return out;
}

export function loadInitialRecents(
  opts: CreateRecentsStoreOptions = {},
): RecentsMap {
  const merged: RecentsMap = {
    folder: [...(opts.initial?.['folder'] ?? [])],
    file: [...(opts.initial?.['file'] ?? [])],
  };
  for (const k of Object.keys(merged) as BucketKey[]) {
    merged[k] = sanitize(merged[k]);
  }
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  if (!storage) return merged;
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return merged;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const folder = mergeOldBuckets(
      parsed['folder'],
      parsed['folder:left'],
      parsed['folder:right'],
    );
    const file = mergeOldBuckets(
      parsed['file'],
      parsed['file:left'],
      parsed['file:right'],
    );
    if (folder.length > 0) merged['folder'] = folder;
    if (file.length > 0) merged['file'] = file;
  } catch {
    /* fall through with defaults */
  }
  return merged;
}

export function createRecentsStore(opts: CreateRecentsStoreOptions = {}) {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const persist = (next: RecentsMap): void => {
    storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    opts.onSave?.(next);
  };

  return create<RecentsState>((set, getState) => ({
    recents: loadInitialRecents(opts),

    add: (kind, value) => {
      const trimmed = (value ?? '').trim();
      if (!trimmed) return;
      const current = getState().recents[kind];
      const filtered = current.filter((v) => v !== trimmed);
      const nextList = [trimmed, ...filtered].slice(0, RECENTS_LIMIT);
      const nextMap: RecentsMap = { ...getState().recents, [kind]: nextList };
      persist(nextMap);
      set({ recents: nextMap });
    },

    get: (kind) => getState().recents[kind],

    clear: (kind) => {
      const nextMap: RecentsMap = { ...getState().recents, [kind]: [] };
      persist(nextMap);
      set({ recents: nextMap });
    },

    reset: () => {
      const nextMap: RecentsMap = { folder: [], file: [] };
      persist(nextMap);
      set({ recents: nextMap });
    },

    load: (data) => {
      set({
        recents: {
          folder: mergeOldBuckets(
            data['folder'],
            data['folder:left'],
            data['folder:right'],
          ),
          file: mergeOldBuckets(
            data['file'],
            data['file:left'],
            data['file:right'],
          ),
        },
      });
    },
  }));
}

export type RecentsStore = ReturnType<typeof createRecentsStore>;

/** Re-exported empty map for tests / callers that need a default. */
export const EMPTY_RECENTS: RecentsMap = EMPTY_MAP;
