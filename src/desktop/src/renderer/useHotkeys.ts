import { useEffect } from 'react';
import type { RowAction } from './actions.js';

export interface HotkeyBinding {
  action: RowAction;
  /** Lowercase key as reported by `KeyboardEvent.key`. */
  key: string;
  alt?: boolean;
  ctrlOrMeta?: boolean;
  shift?: boolean;
}

/**
 * Default Beyond-Compare-inspired hotkey table. Cmd is treated as
 * equivalent to Ctrl so Mac users get the same bindings.
 */
export const DEFAULT_HOTKEYS: readonly HotkeyBinding[] = [
  { action: 'compare', key: 'f5' },
  { action: 'open', key: 'f6' },
  { action: 'copyLeftToRight', key: 'arrowright', alt: true },
  { action: 'copyRightToLeft', key: 'arrowleft', alt: true },
  { action: 'delete', key: 'delete' },
  { action: 'markSame', key: 'm', ctrlOrMeta: true },
  { action: 'exclude', key: 'e', ctrlOrMeta: true },
];

export interface UseHotkeysOptions {
  bindings?: readonly HotkeyBinding[];
  /** Inject the event source. Defaults to `window`. Used by tests. */
  target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  /**
   * Called for each matched hotkey. Return `true` to mark the event
   * as handled (the hook will then call `preventDefault`).
   */
  onAction(action: RowAction, event: KeyboardEvent): boolean | void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((target as HTMLElement).isContentEditable) return true;
  return false;
}

export function matchHotkey(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  bindings: readonly HotkeyBinding[],
): RowAction | null {
  const key = event.key.toLowerCase();
  const ctrlOrMeta = event.ctrlKey || event.metaKey;
  for (const b of bindings) {
    if (b.key !== key) continue;
    if (Boolean(b.alt) !== event.altKey) continue;
    if (Boolean(b.ctrlOrMeta) !== ctrlOrMeta) continue;
    if (Boolean(b.shift) !== event.shiftKey) continue;
    return b.action;
  }
  return null;
}

export function useHotkeys(opts: UseHotkeysOptions): void {
  const { bindings = DEFAULT_HOTKEYS, target, onAction } = opts;
  useEffect(() => {
    const node: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | undefined =
      target ?? (typeof window === 'undefined' ? undefined : window);
    if (!node) return;
    const handler = (event: Event): void => {
      const ke = event as KeyboardEvent;
      // Don't steal hotkeys while the user is typing into an input.
      // F5/F6 still pass through (no modifier-free conflict with editing).
      if (isEditableTarget(ke.target)) {
        const allowEditable = ke.key === 'F5' || ke.key === 'F6';
        if (!allowEditable) return;
      }
      const action = matchHotkey(ke, bindings);
      if (!action) return;
      const handled = onAction(action, ke);
      if (handled !== false) ke.preventDefault();
    };
    node.addEventListener('keydown', handler);
    return () => {
      node.removeEventListener('keydown', handler);
    };
  }, [bindings, target, onAction]);
}
