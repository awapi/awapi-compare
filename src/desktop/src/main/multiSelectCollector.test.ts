import { describe, expect, it, vi } from 'vitest';

import { MultiSelectCollector, type CollectorTimer } from './multiSelectCollector.js';

/**
 * A deterministic fake timer harness. `add`/`flush` schedule callbacks
 * that only fire when the test calls `tick()`, so the collector's
 * debounce behaviour is exercised without real time.
 */
function makeHarness() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  const setTimeoutFn = (cb: () => void): CollectorTimer => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id as unknown as CollectorTimer;
  };
  const clearTimeoutFn = (handle: CollectorTimer): void => {
    callbacks.delete(handle as unknown as number);
  };
  /** Fire the most recently scheduled (still-pending) callback. */
  const tick = (): void => {
    const ids = [...callbacks.keys()];
    const last = ids[ids.length - 1];
    if (last === undefined) return;
    const cb = callbacks.get(last);
    callbacks.delete(last);
    cb?.();
  };
  return { setTimeoutFn, clearTimeoutFn, tick, pendingTimers: () => callbacks.size };
}

describe('MultiSelectCollector', () => {
  it('resolves a single path when only one launch arrives', () => {
    const onResolve = vi.fn();
    const h = makeHarness();
    const c = new MultiSelectCollector({
      onResolve,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
    });

    c.add('/a');
    expect(onResolve).not.toHaveBeenCalled();
    h.tick();
    expect(onResolve).toHaveBeenCalledWith(['/a']);
  });

  it('batches two near-simultaneous launches into one pair', () => {
    const onResolve = vi.fn();
    const h = makeHarness();
    const c = new MultiSelectCollector({
      onResolve,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
    });

    c.add('/left');
    c.add('/right');
    h.tick();
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith(['/left', '/right']);
  });

  it('preserves arrival order (first = left, second = right)', () => {
    const onResolve = vi.fn();
    const h = makeHarness();
    const c = new MultiSelectCollector({
      onResolve,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
    });

    c.add('/first');
    c.add('/second');
    c.add('/third');
    h.tick();
    expect(onResolve).toHaveBeenCalledWith(['/first', '/second', '/third']);
  });

  it('each add restarts the settle window (debounce)', () => {
    const onResolve = vi.fn();
    const h = makeHarness();
    const c = new MultiSelectCollector({
      onResolve,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
    });

    c.add('/a');
    c.add('/b');
    // Only one timer should be live because the second add cleared the first.
    expect(h.pendingTimers()).toBe(1);
    h.tick();
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it('reports pending while paths are buffered and clears after resolve', () => {
    const onResolve = vi.fn();
    const h = makeHarness();
    const c = new MultiSelectCollector({
      onResolve,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
    });

    expect(c.pending).toBe(false);
    c.add('/a');
    expect(c.pending).toBe(true);
    h.tick();
    expect(c.pending).toBe(false);
  });

  it('starts a fresh batch after a previous one resolves', () => {
    const onResolve = vi.fn();
    const h = makeHarness();
    const c = new MultiSelectCollector({
      onResolve,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
    });

    c.add('/a');
    h.tick();
    c.add('/b');
    c.add('/c');
    h.tick();
    expect(onResolve).toHaveBeenNthCalledWith(1, ['/a']);
    expect(onResolve).toHaveBeenNthCalledWith(2, ['/b', '/c']);
  });

  it('flush() resolves immediately and cancels the pending timer', () => {
    const onResolve = vi.fn();
    const h = makeHarness();
    const c = new MultiSelectCollector({
      onResolve,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
    });

    c.add('/a');
    c.flush();
    expect(onResolve).toHaveBeenCalledWith(['/a']);
    expect(h.pendingTimers()).toBe(0);
  });

  it('flush() is a no-op when nothing is buffered', () => {
    const onResolve = vi.fn();
    const h = makeHarness();
    const c = new MultiSelectCollector({
      onResolve,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
    });

    c.flush();
    expect(onResolve).not.toHaveBeenCalled();
  });
});
