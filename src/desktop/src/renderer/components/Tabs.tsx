import type { JSX, KeyboardEvent, MouseEvent } from 'react';
import type { WorkspaceTab } from '../state/workspaceStore.js';

export interface TabsProps {
  tabs: readonly WorkspaceTab[];
  activeTabId: string;
  onSelect(id: string): void;
  onClose(id: string): void;
  /** Optional handler for the "+" button that opens a new compare tab. */
  onNewCompareTab?(): void;
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
}: TabsProps): JSX.Element {
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
    </div>
  );
}
