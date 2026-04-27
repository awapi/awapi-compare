import type { JSX, KeyboardEvent, MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { WorkspaceTab } from '../state/workspaceStore.js';

export interface TabsProps {
  tabs: readonly WorkspaceTab[];
  activeTabId: string;
  onSelect(id: string): void;
  onClose(id: string): void;
  /** Optional handler for the "+" button that opens a new compare tab. */
  onNewCompareTab?(): void;
  /** Close every tab except the one with the given id. */
  onCloseOthers?(id: string): void;
  /** Close every tab (preserving the workspace invariant). */
  onCloseAll?(): void;
}

interface TabMenuState {
  tabId: string;
  x: number;
  y: number;
}

/**
 * A tab is closable unless it's the **last remaining compare tab** —
 * the workspace must always contain at least one compare session.
 */
function isClosable(tab: WorkspaceTab, tabs: readonly WorkspaceTab[]): boolean {
  if (tab.kind === 'fileDiff') return true;
  const compareCount = tabs.filter((t) => t.kind === 'compare').length;
  return compareCount > 1;
}

export function Tabs({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewCompareTab,
  onCloseOthers,
  onCloseAll,
}: TabsProps): JSX.Element {
  const [menu, setMenu] = useState<TabMenuState | null>(null);
  const closeMenu = (): void => setMenu(null);

  return (
    <div className="awapi-tabs" role="tablist" aria-label="Workspace tabs">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const closable = isClosable(tab, tabs);
        const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(tab.id);
          }
        };
        const handleClose = (event: MouseEvent<HTMLButtonElement>): void => {
          event.stopPropagation();
          onClose(tab.id);
        };
        const handleContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
          if (!onCloseOthers && !onCloseAll && !closable) return;
          event.preventDefault();
          setMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
        };
        return (
          <div
            key={tab.id}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            aria-selected={isActive}
            data-tab-id={tab.id}
            data-dirty={tab.dirty ? 'true' : undefined}
            className={
              isActive ? 'awapi-tab awapi-tab--active' : 'awapi-tab'
            }
            onClick={() => onSelect(tab.id)}
            onKeyDown={handleKeyDown}
            onContextMenu={handleContextMenu}
          >
            <span className="awapi-tab__title">
              {tab.dirty ? (
                <span className="awapi-tab__dirty" aria-label="Unsaved changes">
                  *
                </span>
              ) : null}
              {tab.title}
            </span>
            {closable ? (
              <button
                type="button"
                className="awapi-tab__close"
                aria-label={`Close ${tab.title}`}
                onClick={handleClose}
              >
                ×
              </button>
            ) : null}
          </div>
        );
      })}
      {onNewCompareTab ? (
        <button
          type="button"
          className="awapi-tab awapi-tab__new"
          aria-label="New compare tab"
          title="New compare tab"
          onClick={onNewCompareTab}
        >
          +
        </button>
      ) : null}
      {menu ? (
        <TabContextMenu
          x={menu.x}
          y={menu.y}
          tabId={menu.tabId}
          tabs={tabs}
          onClose={onClose}
          onCloseOthers={onCloseOthers}
          onCloseAll={onCloseAll}
          onDismiss={closeMenu}
        />
      ) : null}
    </div>
  );
}

interface TabContextMenuProps {
  x: number;
  y: number;
  tabId: string;
  tabs: readonly WorkspaceTab[];
  onClose(id: string): void;
  onCloseOthers?(id: string): void;
  onCloseAll?(): void;
  onDismiss(): void;
}

/**
 * Context menu shown on right-click of a workspace tab. Mirrors
 * VS Code's tab menu (Close / Close Others / Close All) and disables
 * actions that would violate the "at least one compare tab" invariant.
 */
function TabContextMenu({
  x,
  y,
  tabId,
  tabs,
  onClose,
  onCloseOthers,
  onCloseAll,
  onDismiss,
}: TabContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointer = (event: PointerEvent): void => {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node | null)) onDismiss();
    };
    const handleKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('pointerdown', handlePointer, true);
    document.addEventListener('keydown', handleKey, true);
    ref.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', handlePointer, true);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [onDismiss]);

  const target = tabs.find((t) => t.id === tabId);
  const targetClosable = target ? isClosable(target, tabs) : false;
  const otherClosableCount = tabs.filter(
    (t) => t.id !== tabId && isClosable(t, tabs),
  ).length;
  const anyClosable = tabs.some((t) => isClosable(t, tabs));

  const items: ReadonlyArray<{
    key: string;
    label: string;
    disabled: boolean;
    onSelect: () => void;
  }> = [
    {
      key: 'close',
      label: 'Close',
      disabled: !targetClosable,
      onSelect: () => {
        if (targetClosable) onClose(tabId);
      },
    },
    {
      key: 'closeOthers',
      label: 'Close Others',
      disabled: !onCloseOthers || otherClosableCount === 0,
      onSelect: () => {
        if (onCloseOthers && otherClosableCount > 0) onCloseOthers(tabId);
      },
    },
    {
      key: 'closeAll',
      label: 'Close All',
      disabled: !onCloseAll || !anyClosable,
      onSelect: () => {
        if (onCloseAll && anyClosable) onCloseAll();
      },
    },
  ];

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      className="awapi-context-menu"
      data-testid="tab-context-menu"
      style={{ position: 'fixed', top: y, left: x }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className="awapi-context-menu__item"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onDismiss();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (item.disabled) return;
              item.onSelect();
              onDismiss();
            }
          }}
        >
          <span className="awapi-context-menu__label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
