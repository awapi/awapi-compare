import { describe, expect, it } from 'vitest';
import {
  createRecentsStore,
  loadInitialRecents,
  RECENTS_LIMIT,
  RECENTS_STORAGE_KEY,
} from './recentsStore.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      map.set(k, v);
    },
    snapshot: (): Record<string, string> => Object.fromEntries(map),
  };
}

describe('recentsStore', () => {
  it('starts empty when storage has no entry', () => {
    const useStore = createRecentsStore({ storage: memoryStorage() });
    expect(useStore.getState().get('folder', 'left')).toEqual([]);
    expect(useStore.getState().get('folder', 'right')).toEqual([]);
    expect(useStore.getState().get('file', 'left')).toEqual([]);
    expect(useStore.getState().get('file', 'right')).toEqual([]);
  });

  it('adds new entries to the front and dedupes', () => {
    const useStore = createRecentsStore({ storage: memoryStorage() });
    useStore.getState().add('folder', 'left', '/a');
    useStore.getState().add('folder', 'left', '/b');
    useStore.getState().add('folder', 'left', '/a');
    expect(useStore.getState().get('folder', 'left')).toEqual(['/a', '/b']);
  });

  it('ignores blank values', () => {
    const useStore = createRecentsStore({ storage: memoryStorage() });
    useStore.getState().add('folder', 'left', '   ');
    useStore.getState().add('folder', 'left', '');
    expect(useStore.getState().get('folder', 'left')).toEqual([]);
  });

  it('caps each bucket at RECENTS_LIMIT entries', () => {
    const useStore = createRecentsStore({ storage: memoryStorage() });
    for (let i = 0; i < RECENTS_LIMIT + 5; i += 1) {
      useStore.getState().add('file', 'right', `/p${i}`);
    }
    const list = useStore.getState().get('file', 'right');
    expect(list).toHaveLength(RECENTS_LIMIT);
    // Newest first.
    expect(list[0]).toBe(`/p${RECENTS_LIMIT + 4}`);
  });

  it('keeps buckets independent', () => {
    const useStore = createRecentsStore({ storage: memoryStorage() });
    useStore.getState().add('folder', 'left', '/a');
    useStore.getState().add('folder', 'right', '/b');
    useStore.getState().add('file', 'left', '/c');
    expect(useStore.getState().get('folder', 'left')).toEqual(['/a']);
    expect(useStore.getState().get('folder', 'right')).toEqual(['/b']);
    expect(useStore.getState().get('file', 'left')).toEqual(['/c']);
    expect(useStore.getState().get('file', 'right')).toEqual([]);
  });

  it('persists additions to storage', () => {
    const storage = memoryStorage();
    const useStore = createRecentsStore({ storage });
    useStore.getState().add('folder', 'left', '/a');
    useStore.getState().add('folder', 'left', '/b');
    const raw = storage.snapshot()[RECENTS_STORAGE_KEY];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed['folder:left']).toEqual(['/b', '/a']);
  });

  it('rehydrates from storage on next load', () => {
    const storage = memoryStorage({
      [RECENTS_STORAGE_KEY]: JSON.stringify({
        'folder:left': ['/a', '/b'],
        'folder:right': ['/c'],
      }),
    });
    const loaded = loadInitialRecents({ storage });
    expect(loaded['folder:left']).toEqual(['/a', '/b']);
    expect(loaded['folder:right']).toEqual(['/c']);
    expect(loaded['file:left']).toEqual([]);
  });

  it('drops malformed entries on load', () => {
    const storage = memoryStorage({
      [RECENTS_STORAGE_KEY]: JSON.stringify({
        'folder:left': ['/a', 42, '', '   ', '/a', '/b'],
      }),
    });
    const loaded = loadInitialRecents({ storage });
    expect(loaded['folder:left']).toEqual(['/a', '/b']);
  });

  it('falls back to defaults when storage JSON is corrupt', () => {
    const storage = memoryStorage({ [RECENTS_STORAGE_KEY]: '}{not json' });
    const loaded = loadInitialRecents({ storage });
    expect(loaded['folder:left']).toEqual([]);
  });

  it('clear() empties a single bucket without touching others', () => {
    const useStore = createRecentsStore({ storage: memoryStorage() });
    useStore.getState().add('folder', 'left', '/a');
    useStore.getState().add('folder', 'right', '/b');
    useStore.getState().clear('folder', 'left');
    expect(useStore.getState().get('folder', 'left')).toEqual([]);
    expect(useStore.getState().get('folder', 'right')).toEqual(['/b']);
  });

  it('reset() empties every bucket', () => {
    const useStore = createRecentsStore({ storage: memoryStorage() });
    useStore.getState().add('folder', 'left', '/a');
    useStore.getState().add('file', 'right', '/b');
    useStore.getState().reset();
    expect(useStore.getState().get('folder', 'left')).toEqual([]);
    expect(useStore.getState().get('file', 'right')).toEqual([]);
  });
});
