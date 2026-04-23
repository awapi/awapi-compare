import type { JSX, KeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';
import type { RowAction } from '../actions.js';

export interface ContextMenuItem {
  action: RowAction;
  label: string;
  /** When true the item is rendered but cannot be activated. */
  disabled?: boolean;
  /** Display-only accelerator (e.g. "Alt+→"). */
  accelerator?: string;
}

export interface ContextMenuProps {
  /** Position in viewport coordinates. */
  x: number;
  y: number;
  items: readonly ContextMenuItem[];
  onSelect(action: RowAction): void;
  onClose(): void;
}

/**
 * Lightweight popover menu used by `DiffTable` row context menus.
 * Closes on outside click, Escape, blur, and after a selection. The
 * menu is keyboard-navigable via Arrow/Enter.
 */
export function ContextMenu({
  x,
  y,
  items,
  onSelect,
  onClose,
}: ContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointer = (event: PointerEvent): void => {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node | null)) onClose();
    };
    const handleKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handlePointer, true);
    document.addEventListener('keydown', handleKey, true);
    // Focus the menu so keyboard nav works immediately.
    ref.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', handlePointer, true);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [onClose]);

  const handleItemKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    item: ContextMenuItem,
  ): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!item.disabled) onSelect(item.action);
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      className="awapi-context-menu"
      data-testid="context-menu"
      style={{ position: 'fixed', top: y, left: x }}
    >
      {items.map((item) => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          className="awapi-context-menu__item"
          disabled={item.disabled}
          onClick={() => {
            if (!item.disabled) onSelect(item.action);
          }}
          onKeyDown={(event) => handleItemKey(event, item)}
        >
          <span className="awapi-context-menu__label">{item.label}</span>
          {item.accelerator ? (
            <span className="awapi-context-menu__accel" aria-hidden="true">
              {item.accelerator}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
