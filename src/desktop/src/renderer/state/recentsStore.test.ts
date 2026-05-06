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
    expect(useStore.getState().get('folder')).toEqual([]);
    expect(useStore.getState().get('file')).toEqual([]);
  });

  it('adds new entries to the front and dedupes', () => {
    const useStore = createRecentsStore({ storage: memoryStorage() });
    useStore.getState().add('folder', '/a');
    useStore.getState().add('folder', '/b');
    useStore.getState().add('folder', '/a');
    expect(useStore.getState().get('folder')).toEqual(['/a', '/b']);
  });

  it('ignores blank values', () => {
    const useStore = createRecentsStore({ storage: memoryStorage() });
    useStore.getState().add('folder', '   ');
    useStore.getState().add('folder', '');
    expect(useStore.getState().get('folder')).toEqual([]);
  });

  it('caps each bucket at RECENTS_LIMIT entries', () => {
    const useStore = createRecentsStore({ storage: memoryStorage() });
    for (let i = 0; i < RECENTS_LIMIT + 5; i += 1) {
      useStore.getState().add('file', `/p${i}`);
    }
    const list = useStore.getState().get('file');
    expect(list).toHaveLength(RECENTS_LIMIT);
    // Newest first.
    expect(list[0]).toBe(`/p${RECENTS_LIMIT + 4}`);
  });

  it('keeps folder and file buckets independent', () => {
    const useStore = createRecentsStore({ storage: memoryStorage() });
    useStore.getState().add('folder', '/a');
    useStore.getState().add('file', '/b');
    expect(useStore.getState().get('folder')).toEqual(['/a']);
    expect(useStore.getState().get('file')).toEqual(['/b']);
  });

  it('persists additions to storage', () => {
    const storage = memoryStorage();
    const useStore = createRecentsStore({ storage });
    useStore.getState().add('folder', '/a');
    useStore.getState().add('folder', '/b');
    const raw = storage.snapshot()[RECENTS_STORAGE_KEY];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed['folder']).toEqual(['/b', '/a']);
  });

  it('rehydrates from storage on next load', () => {
    const storage = memoryStorage({
      [RECENTS_STORAGE_KEY]: JSON.stringify({
        folder: ['/a', '/b'],
        file: ['/c'],
      }),
    });
    const loaded = loadInitialRecents({ storage });
    expect(loaded['folder']).toEqual(['/a', '/b']);
    expect(loaded['file']).toEqual(['/c']);
  });

  it('migrates old per-side buckets on load', () => {
    const storage = memoryStorage({
      [RECENTS_STORAGE_KEY]: JSON.stringify({
        'folder:left': ['/left1', '/left2'],
        'folder:right': ['/right1', '/right2'],
        'file:left': ['/f1'],
        'file:right': ['/f2'],
      }),
    });
    const loaded = loadInitialRecents({ storage });
    // Interleaved, deduped, newest first
    expect(loaded['folder']).toEqual(['/left1', '/right1', '/left2', '/right2']);
    expect(loaded['file']).toEqual(['/f1', '/f2']);
  });

  it('drops malformed entries on load', () => {
    const storage = memoryStorage({
      [RECENTS_STORAGE_KEY]: JSON.stringify({
        folder: ['/a', 42, '', '   ', '/a', '/b'],
      }),
    });
    const loaded = loadInitialRecents({ storage });
    expect(loaded['folder']).toEqual(['/a', '/b']);
  });

  it('falls back to defaults when storage JSON is corrupt', () => {
    const storage = memoryStorage({ [RECENTS_STORAGE_KEY]: '}{not json' });
    const loaded = loadInitialRecents({ storage });
    expect(loaded['folder']).toEqual([]);
  });

  it('clear() empties a single bucket without touching the other', () => {
    const useStore = createRecentsStore({ storage: memoryStorage() });
    useStore.getState().add('folder', '/a');
    useStore.getState().add('file', '/b');
    useStore.getState().clear('folder');
    expect(useStore.getState().get('folder')).toEqual([]);
    expect(useStore.getState().get('file')).toEqual(['/b']);
  });

  it('reset() empties every bucket', () => {
    const useStore = createRecentsStore({ storage: memoryStorage() });
    useStore.getState().add('folder', '/a');
    useStore.getState().add('file', '/b');
    useStore.getState().reset();
    expect(useStore.getState().get('folder')).toEqual([]);
    expect(useStore.getState().get('file')).toEqual([]);
  });
});
