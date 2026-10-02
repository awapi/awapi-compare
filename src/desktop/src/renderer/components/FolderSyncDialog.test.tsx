import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComparedPair, EntryType, FolderSyncPlan, FsEntry } from '@awapi/shared';

import { FolderSyncDialog } from './FolderSyncDialog.js';
import type { FolderSyncResult } from '../folderSyncRunner.js';

function entry(relPath: string, type: EntryType = 'file'): FsEntry {
  return { relPath, name: relPath, type, size: 1, mtimeMs: 0, mode: 0 };
}

const PAIRS: ComparedPair[] = [
  { relPath: 'new.txt', status: 'left-only', left: entry('new.txt') },
  { relPath: 'old.txt', status: 'newer-left', left: entry('old.txt'), right: entry('old.txt') },
  { relPath: 'orphan.txt', status: 'right-only', right: entry('orphan.txt') },
  { relPath: 'same.txt', status: 'identical', left: entry('same.txt'), right: entry('same.txt') },
  { relPath: 'clash', status: 'different', left: entry('clash'), right: entry('clash', 'dir') },
];

const OK: FolderSyncResult = { succeeded: 2, failed: 0, errors: [] };

function renderDialog(overrides: Partial<Parameters<typeof FolderSyncDialog>[0]> = {}) {
  const onRun = vi.fn<(plan: FolderSyncPlan) => Promise<FolderSyncResult>>().mockResolvedValue(OK);
  const onClose = vi.fn();
  render(
    <FolderSyncDialog
      pairs={PAIRS}
      selectedPaths={new Set()}
      onRun={onRun}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onRun, onClose };
}

describe('<FolderSyncDialog />', () => {
  it('previews the update left → right plan by default, including conflicts', () => {
    renderDialog();
    expect(screen.getByText(/Preview: 2 copy → right, 0 copy ← left, 0 delete/)).toBeInTheDocument();
    expect(screen.getByText(/1 conflict \(skipped\)/)).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      'Copy → rightnew.txt',
      'Copy → right (replaces)old.txt',
    ]);
  });

  it('re-plans when the mode changes and gates deletions behind a confirmation', async () => {
    const { onRun } = renderDialog();
    await userEvent.selectOptions(screen.getByLabelText('Sync mode'), 'mirror-left-to-right');
    expect(screen.getByText('Delete from right')).toBeInTheDocument();
    const sync = screen.getByRole('button', { name: 'Sync' });
    expect(sync).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/permanently delete 1 item/i));
    expect(sync).toBeEnabled();
    await userEvent.click(sync);
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
    expect(onRun.mock.calls[0]?.[0].mode).toBe('mirror-left-to-right');
  });

  it('shows the result and reports didRun on close', async () => {
    const { onRun, onClose } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }));
    expect(await screen.findByText(/Synced 2 items successfully/)).toBeInTheDocument();
    expect(onRun).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('lists per-item failures in the result', async () => {
    renderDialog({
      onRun: vi.fn().mockResolvedValue({ succeeded: 1, failed: 1, errors: ['old.txt: denied'] }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }));
    expect(await screen.findByText(/1 failed/)).toBeInTheDocument();
    expect(screen.getByText('old.txt: denied')).toBeInTheDocument();
  });

  it('surfaces an error thrown by the runner', async () => {
    const { onClose } = renderDialog({ onRun: vi.fn().mockRejectedValue(new Error('no roots')) });
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no roots');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('restricts the plan to the selected rows when asked', async () => {
    renderDialog({ selectedPaths: new Set(['new.txt']) });
    await userEvent.click(screen.getByLabelText('Selected rows only'));
    expect(screen.getByText(/Preview: 1 copy → right/)).toBeInTheDocument();
    expect(screen.queryByText('old.txt')).toBeNull();
  });

  it('disables the selection scope when nothing is selected', () => {
    renderDialog();
    expect(screen.getByLabelText('Selected rows only')).toBeDisabled();
  });

  it('reports nothing to sync and disables Sync', () => {
    renderDialog({ pairs: [PAIRS[3] as ComparedPair] });
    expect(screen.getByText('Nothing to sync.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync' })).toBeDisabled();
  });

  it('caps the preview and closes from the backdrop', async () => {
    const many: ComparedPair[] = Array.from({ length: 502 }, (_, i) => {
      const p = `f${String(i).padStart(4, '0')}`;
      return { relPath: p, status: 'left-only', left: entry(p) };
    });
    const { onClose } = renderDialog({ pairs: many });
    expect(screen.getByText('…and 2 more.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('marks folder operations', async () => {
    renderDialog({
      pairs: [{ relPath: 'dir', status: 'left-only', left: entry('dir', 'dir') }],
    });
    expect(screen.getByText('Copy → right (folder)')).toBeInTheDocument();
  });
});
