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
});
