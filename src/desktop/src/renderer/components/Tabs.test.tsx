import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './Tabs.js';
import { COMPARE_TAB_ID, type WorkspaceTab } from '../state/workspaceStore.js';

const TABS: WorkspaceTab[] = [
  { id: COMPARE_TAB_ID, kind: 'compare', title: 'Compare' },
  { id: 't1', kind: 'fileDiff', title: 'foo.txt', relPath: 'foo.txt' },
];

describe('<Tabs />', () => {
  it('marks the active tab via aria-selected', () => {
    render(
      <Tabs tabs={TABS} activeTabId="t1" onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const compare = screen.getByRole('tab', { name: /compare/i });
    const file = screen.getByRole('tab', { name: /foo\.txt/i });
    expect(compare).toHaveAttribute('aria-selected', 'false');
    expect(file).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onSelect when a tab is clicked', async () => {
    const onSelect = vi.fn();
    render(
      <Tabs tabs={TABS} activeTabId={COMPARE_TAB_ID} onSelect={onSelect} onClose={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('tab', { name: /foo\.txt/i }));
    expect(onSelect).toHaveBeenCalledWith('t1');
  });

  it('the compare tab has no close button; file-diff tabs do', () => {
    render(
      <Tabs tabs={TABS} activeTabId="t1" onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /close compare/i })).toBeNull();
    expect(screen.getByRole('button', { name: /close foo\.txt/i })).toBeInTheDocument();
  });

  it('clicking close fires onClose without bubbling to onSelect', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <Tabs tabs={TABS} activeTabId={COMPARE_TAB_ID} onSelect={onSelect} onClose={onClose} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /close foo\.txt/i }));
    expect(onClose).toHaveBeenCalledWith('t1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Enter on a focused tab activates it', () => {
    const onSelect = vi.fn();
    render(
      <Tabs tabs={TABS} activeTabId={COMPARE_TAB_ID} onSelect={onSelect} onClose={vi.fn()} />,
    );
    const file = screen.getByRole('tab', { name: /foo\.txt/i });
    fireEvent.keyDown(file, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('t1');
  });

  it('right-click opens a context menu with Close / Close Others / Close All', () => {
    const tabs: WorkspaceTab[] = [
      ...TABS,
      { id: 't2', kind: 'fileDiff', title: 'bar.txt', relPath: 'bar.txt' },
    ];
    render(
      <Tabs
        tabs={tabs}
        activeTabId={COMPARE_TAB_ID}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCloseOthers={vi.fn()}
        onCloseAll={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('tab', { name: /foo\.txt/i }));
    const menu = screen.getByTestId('tab-context-menu');
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Close Others' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Close All' })).toBeEnabled();
  });

  it('Close menu item invokes onClose for the right-clicked tab', async () => {
    const onClose = vi.fn();
    render(
      <Tabs
        tabs={TABS}
        activeTabId={COMPARE_TAB_ID}
        onSelect={vi.fn()}
        onClose={onClose}
        onCloseOthers={vi.fn()}
        onCloseAll={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('tab', { name: /foo\.txt/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledWith('t1');
    expect(screen.queryByTestId('tab-context-menu')).toBeNull();
  });

  it('Close Others invokes onCloseOthers with the right-clicked tab id', async () => {
    const onCloseOthers = vi.fn();
    const tabs: WorkspaceTab[] = [
      ...TABS,
      { id: 't2', kind: 'fileDiff', title: 'bar.txt', relPath: 'bar.txt' },
    ];
    render(
      <Tabs
        tabs={tabs}
        activeTabId={COMPARE_TAB_ID}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCloseOthers={onCloseOthers}
        onCloseAll={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('tab', { name: /foo\.txt/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close Others' }));
    expect(onCloseOthers).toHaveBeenCalledWith('t1');
  });

  it('Close All invokes onCloseAll', async () => {
    const onCloseAll = vi.fn();
    render(
      <Tabs
        tabs={TABS}
        activeTabId={COMPARE_TAB_ID}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCloseOthers={vi.fn()}
        onCloseAll={onCloseAll}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('tab', { name: /foo\.txt/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close All' }));
    expect(onCloseAll).toHaveBeenCalledTimes(1);
  });

  it('Close is disabled when right-clicking the only compare tab', () => {
    const ONLY_COMPARE: WorkspaceTab[] = [
      { id: COMPARE_TAB_ID, kind: 'compare', title: 'Compare' },
    ];
    render(
      <Tabs
        tabs={ONLY_COMPARE}
        activeTabId={COMPARE_TAB_ID}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCloseOthers={vi.fn()}
        onCloseAll={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('tab', { name: /compare/i }));
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Close Others' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Close All' })).toBeDisabled();
  });

  it('Escape dismisses the tab context menu', () => {
    render(
      <Tabs
        tabs={TABS}
        activeTabId={COMPARE_TAB_ID}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCloseOthers={vi.fn()}
        onCloseAll={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('tab', { name: /foo\.txt/i }));
    expect(screen.getByTestId('tab-context-menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('tab-context-menu')).toBeNull();
  });
});
