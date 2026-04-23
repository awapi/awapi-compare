import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_HOTKEYS, matchHotkey } from './useHotkeys.js';

function ev(
  init: Partial<Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>>,
): Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'> {
  return {
    key: init.key ?? '',
    altKey: init.altKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
  };
}

describe('matchHotkey', () => {
  it('maps F5 to compare', () => {
    expect(matchHotkey(ev({ key: 'F5' }), DEFAULT_HOTKEYS)).toBe('compare');
  });

  it('maps F6 to open', () => {
    expect(matchHotkey(ev({ key: 'F6' }), DEFAULT_HOTKEYS)).toBe('open');
  });

  it('maps Alt+ArrowRight to copyLeftToRight', () => {
    expect(
      matchHotkey(ev({ key: 'ArrowRight', altKey: true }), DEFAULT_HOTKEYS),
    ).toBe('copyLeftToRight');
  });

  it('maps Alt+ArrowLeft to copyRightToLeft', () => {
    expect(
      matchHotkey(ev({ key: 'ArrowLeft', altKey: true }), DEFAULT_HOTKEYS),
    ).toBe('copyRightToLeft');
  });

  it('maps Delete to delete', () => {
    expect(matchHotkey(ev({ key: 'Delete' }), DEFAULT_HOTKEYS)).toBe('delete');
  });

  it('treats Cmd as Ctrl on macOS', () => {
    expect(matchHotkey(ev({ key: 'm', metaKey: true }), DEFAULT_HOTKEYS)).toBe('markSame');
    expect(matchHotkey(ev({ key: 'e', ctrlKey: true }), DEFAULT_HOTKEYS)).toBe('exclude');
  });

  it('rejects modifier mismatch', () => {
    expect(matchHotkey(ev({ key: 'ArrowRight' }), DEFAULT_HOTKEYS)).toBeNull();
    expect(
      matchHotkey(ev({ key: 'm', ctrlKey: true, shiftKey: true }), DEFAULT_HOTKEYS),
    ).toBeNull();
  });

  it('rejects unrelated keys', () => {
    expect(matchHotkey(ev({ key: 'Escape' }), DEFAULT_HOTKEYS)).toBeNull();
  });
});

describe('useHotkeys (event source)', () => {
  it('subscribes and unsubscribes on the injected target', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useHotkeys } = await import('./useHotkeys.js');
    const target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const onAction = vi.fn();
    const { unmount } = renderHook(() => useHotkeys({ target, onAction }));
    expect(target.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    unmount();
    expect(target.removeEventListener).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
    );
  });
});
