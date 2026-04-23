import { describe, expect, it } from 'vitest';
import type { ComparedPair, Rule } from '@awapi/shared';
import {
  createEmptySnapshot,
  createSessionStore,
  type SessionSnapshot,
} from './sessionStore.js';

const FIXED_NOW = 1_700_000_000_000;

function makeStore(initial?: Partial<SessionSnapshot>) {
  let counter = 0;
  return createSessionStore({
    initial,
    generateId: () => `id-${++counter}`,
    now: () => FIXED_NOW,
  });
}

describe('createEmptySnapshot', () => {
  it('uses injected id generator and clock', () => {
    const snap = createEmptySnapshot(
      () => 'fixed-id',
      () => 42,
    );
    expect(snap).toEqual({
      id: 'fixed-id',
      leftRoot: '',
      rightRoot: '',
      mode: 'quick',
      rules: [],
      createdAt: 42,
      updatedAt: 42,
    });
  });
});

describe('sessionStore', () => {
  it('seeds defaults and merges initial snapshot fields', () => {
    const store = makeStore({ leftRoot: '/a', rightRoot: '/b', mode: 'thorough' });
    const s = store.getState();
    expect(s.id).toBe('id-1');
    expect(s.leftRoot).toBe('/a');
    expect(s.rightRoot).toBe('/b');
    expect(s.mode).toBe('thorough');
    expect(s.pairs).toEqual([]);
    expect(s.scanning).toBe(false);
    expect(s.progress).toBeNull();
    expect(s.selectedPath).toBeNull();
    expect(s.error).toBeNull();
  });

  it('clears pairs and selection when roots or mode change', () => {
    const store = makeStore();
    const pairs: ComparedPair[] = [{ relPath: 'a', status: 'identical' }];
    store.getState().setPairs(pairs);
    store.getState().setSelectedPath('a');
    expect(store.getState().pairs).toHaveLength(1);

    store.getState().setLeftRoot('/new-left');
    expect(store.getState().pairs).toEqual([]);
    expect(store.getState().selectedPath).toBeNull();

    store.getState().setPairs(pairs);
    store.getState().setRightRoot('/new-right');
    expect(store.getState().pairs).toEqual([]);

    store.getState().setPairs(pairs);
    store.getState().setMode('binary');
    expect(store.getState().pairs).toEqual([]);
  });

  it('does not clear pairs when only rules or name change', () => {
    const store = makeStore();
    const pairs: ComparedPair[] = [{ relPath: 'a', status: 'identical' }];
    store.getState().setPairs(pairs);

    const rules: Rule[] = [
      { id: 'r1', kind: 'exclude', pattern: '*.log', enabled: true },
    ];
    store.getState().setRules(rules);
    store.getState().setName('My session');

    expect(store.getState().pairs).toHaveLength(1);
    expect(store.getState().rules).toEqual(rules);
    expect(store.getState().name).toBe('My session');
  });

  it('produces a serializable snapshot via toSnapshot()', () => {
    const store = makeStore({ leftRoot: '/l', rightRoot: '/r' });
    store.getState().setRules([
      { id: 'r1', kind: 'exclude', pattern: '*.tmp', enabled: true },
    ]);
    store.getState().setPairs([{ relPath: 'x', status: 'different' }]);

    const snap = store.getState().toSnapshot();
    // Round-trips through JSON without losing data.
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    // Excludes runtime fields.
    expect(snap).not.toHaveProperty('pairs');
    expect(snap).not.toHaveProperty('scanning');
    expect(snap).not.toHaveProperty('progress');
    expect(snap).not.toHaveProperty('selectedPath');
    expect(snap.leftRoot).toBe('/l');
    expect(snap.rightRoot).toBe('/r');
  });

  it('toSession() matches toSnapshot() shape (wire-compatible)', () => {
    const store = makeStore({ leftRoot: '/l', rightRoot: '/r', name: 'demo' });
    expect(store.getState().toSession()).toEqual(store.getState().toSnapshot());
  });

  it('loadSnapshot replaces persistable state and resets runtime fields', () => {
    const store = makeStore();
    store.getState().setPairs([{ relPath: 'a', status: 'identical' }]);
    store.getState().setScanning(true);
    store.getState().setProgress({ scanned: 10 });
    store.getState().setSelectedPath('a');
    store.getState().setError('oops');

    store.getState().loadSnapshot({
      id: 'loaded',
      name: 'Loaded session',
      leftRoot: '/x',
      rightRoot: '/y',
      mode: 'binary',
      rules: [],
      createdAt: 1,
      updatedAt: 2,
    });

    const s = store.getState();
    expect(s.id).toBe('loaded');
    expect(s.name).toBe('Loaded session');
    expect(s.leftRoot).toBe('/x');
    expect(s.rightRoot).toBe('/y');
    expect(s.mode).toBe('binary');
    expect(s.pairs).toEqual([]);
    expect(s.progress).toBeNull();
    expect(s.scanning).toBe(false);
    expect(s.selectedPath).toBeNull();
    expect(s.error).toBeNull();
  });

  it('updatedAt is bumped by mutating actions', () => {
    let t = 1000;
    const store = createSessionStore({
      generateId: () => 'id',
      now: () => t,
    });
    expect(store.getState().updatedAt).toBe(1000);
    t = 2000;
    store.getState().setLeftRoot('/a');
    expect(store.getState().updatedAt).toBe(2000);
    t = 3000;
    store.getState().setMode('thorough');
    expect(store.getState().updatedAt).toBe(3000);
  });

  it('markSame re-classifies the matching pair only', () => {
    const store = makeStore();
    store.getState().setPairs([
      { relPath: 'a', status: 'different' },
      { relPath: 'b', status: 'different' },
    ]);
    store.getState().markSame('a');
    expect(store.getState().pairs).toEqual([
      { relPath: 'a', status: 'identical' },
      { relPath: 'b', status: 'different' },
    ]);
  });

  it('excludePath re-classifies the matching pair only', () => {
    const store = makeStore();
    store.getState().setPairs([
      { relPath: 'a', status: 'different' },
      { relPath: 'b', status: 'left-only' },
    ]);
    store.getState().excludePath('b');
    expect(store.getState().pairs).toEqual([
      { relPath: 'a', status: 'different' },
      { relPath: 'b', status: 'excluded' },
    ]);
  });

  it('markSame and excludePath are no-ops when the path is unknown', () => {
    const store = makeStore();
    const before: ComparedPair[] = [{ relPath: 'a', status: 'different' }];
    store.getState().setPairs(before);
    store.getState().markSame('zzz');
    store.getState().excludePath('zzz');
    expect(store.getState().pairs).toEqual(before);
  });
});
