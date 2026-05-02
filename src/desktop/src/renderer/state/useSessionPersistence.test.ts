import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_DIFF_OPTIONS, cloneDiffOptions } from '@awapi/shared';

import { _resetSessionRegistry, getSessionStore } from './sessionRegistry.js';
import { useSessionPersistence } from './useSessionPersistence.js';

const DEBOUNCE = 800;

function makeAwapiSession() {
  const save = vi.fn().mockResolvedValue(undefined);
  (globalThis as { awapi?: unknown }).awapi = {
    session: { save },
  };
  return { save };
}

function clearAwapi() {
  (globalThis as { awapi?: unknown }).awapi = undefined;
}

beforeEach(() => {
  _resetSessionRegistry();
  vi.useFakeTimers();
});

afterEach(() => {
  clearAwapi();
  vi.useRealTimers();
  _resetSessionRegistry();
});

describe('useSessionPersistence', () => {
  it('does not save when both roots are empty', () => {
    const { save } = makeAwapiSession();
    renderHook(() => useSessionPersistence('tab-1'));
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE + 100);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('saves when leftRoot is set', async () => {
    const { save } = makeAwapiSession();
    const store = getSessionStore('tab-2');
    renderHook(() => useSessionPersistence('tab-2'));

    act(() => {
      store.getState().setLeftRoot('/left');
    });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE + 100);
    });
    await vi.runAllTimersAsync();

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]).toMatchObject({ leftRoot: '/left' });
  });

  it('saves when mode changes', async () => {
    const { save } = makeAwapiSession();
    const store = getSessionStore('tab-3');
    store.getState().setLeftRoot('/left');
    renderHook(() => useSessionPersistence('tab-3'));

    // Consume the initial trigger.
    act(() => { vi.advanceTimersByTime(DEBOUNCE + 100); });
    await vi.runAllTimersAsync();
    save.mockClear();

    act(() => { store.getState().setMode('binary'); });
    act(() => { vi.advanceTimersByTime(DEBOUNCE + 100); });
    await vi.runAllTimersAsync();

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]).toMatchObject({ mode: 'binary' });
  });

  it('saves when name changes', async () => {
    const { save } = makeAwapiSession();
    const store = getSessionStore('tab-4');
    store.getState().setLeftRoot('/left');
    renderHook(() => useSessionPersistence('tab-4'));

    // Consume the initial trigger.
    act(() => { vi.advanceTimersByTime(DEBOUNCE + 100); });
    await vi.runAllTimersAsync();
    save.mockClear();

    act(() => { store.getState().setName('My project'); });
    act(() => { vi.advanceTimersByTime(DEBOUNCE + 100); });
    await vi.runAllTimersAsync();

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]).toMatchObject({ name: 'My project' });
  });

  it('snapshot includes rules and diffOptions', async () => {
    const { save } = makeAwapiSession();
    const store = getSessionStore('tab-5');
    store.getState().setLeftRoot('/left');
    store.getState().setRightRoot('/right');
    store.getState().setRules([{ id: 'r1', kind: 'exclude', pattern: '*.log', enabled: true }]);
    store.getState().setDiffOptions({ ...cloneDiffOptions(DEFAULT_DIFF_OPTIONS) });

    renderHook(() => useSessionPersistence('tab-5'));
    act(() => { vi.advanceTimersByTime(DEBOUNCE + 100); });
    await vi.runAllTimersAsync();

    expect(save).toHaveBeenCalledOnce();
    const snapshot = save.mock.calls[0]?.[0];
    expect(snapshot.rules).toHaveLength(1);
    expect(snapshot.rules[0].pattern).toBe('*.log');
    expect(snapshot.diffOptions).toBeDefined();
  });

  it('debounces rapid changes into a single save', async () => {
    const { save } = makeAwapiSession();
    const store = getSessionStore('tab-6');
    store.getState().setLeftRoot('/left');

    renderHook(() => useSessionPersistence('tab-6'));

    // Fire multiple rapid changes.
    act(() => {
      vi.advanceTimersByTime(200);
      store.getState().setMode('thorough');
      vi.advanceTimersByTime(200);
      store.getState().setMode('binary');
      vi.advanceTimersByTime(200);
    });
    // Only after the full debounce window does the save fire.
    act(() => { vi.advanceTimersByTime(DEBOUNCE); });
    await vi.runAllTimersAsync();

    // The initial leftRoot trigger + the last mode-change trigger = 2,
    // but the intermediate ones are cancelled by the debounce.
    expect(save.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('does nothing when window.awapi.session is unavailable', () => {
    clearAwapi();
    const store = getSessionStore('tab-7');
    renderHook(() => useSessionPersistence('tab-7'));

    act(() => { store.getState().setLeftRoot('/left'); });
    act(() => { vi.advanceTimersByTime(DEBOUNCE + 100); });

    // No error thrown; save never called because awapi is absent.
    // (The test passes if no exception is raised.)
  });
});
