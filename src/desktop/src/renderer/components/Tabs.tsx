import type { JSX, KeyboardEvent, MouseEvent } from 'react';
import type { WorkspaceTab } from '../state/workspaceStore.js';
import { COMPARE_TAB_ID } from '../state/workspaceStore.js';

export interface TabsProps {
  tabs: readonly WorkspaceTab[];
  activeTabId: string;
  onSelect(id: string): void;
  onClose(id: string): void;
}

export function Tabs({ tabs, activeTabId, onSelect, onClose }: TabsProps): JSX.Element {
  return (
    <div className="awapi-tabs" role="tablist" aria-label="Workspace tabs">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isClosable = tab.id !== COMPARE_TAB_ID;
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
            className={
              isActive ? 'awapi-tab awapi-tab--active' : 'awapi-tab'
            }
            onClick={() => onSelect(tab.id)}
            onKeyDown={handleKeyDown}
          >
            <span className="awapi-tab__title">{tab.title}</span>
            {isClosable ? (
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
    </div>
  );
}
