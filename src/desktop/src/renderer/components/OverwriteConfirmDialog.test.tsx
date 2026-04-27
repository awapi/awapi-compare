import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { OverwriteConfirmDialog } from './OverwriteConfirmDialog.js';

describe('<OverwriteConfirmDialog />', () => {
  it('renders the target name and direction title', () => {
    render(
      <OverwriteConfirmDialog
        target="package.json"
        direction="leftToRight"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Copy → Right' })).toBeInTheDocument();
    expect(screen.getByText('package.json')).toBeInTheDocument();
  });

  it('returns remember=false when Overwrite is clicked without ticking the checkbox', () => {
    const onConfirm = vi.fn();
    render(
      <OverwriteConfirmDialog
        target="x.txt"
        direction="rightToLeft"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('returns remember=true when the checkbox is ticked first', () => {
    const onConfirm = vi.fn();
    render(
      <OverwriteConfirmDialog
        target="x.txt"
        direction="leftToRight"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('cancels via the Cancel button', () => {
    const onCancel = vi.fn();
    render(
      <OverwriteConfirmDialog
        target="x.txt"
        direction="leftToRight"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
