import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CreateMissingSideDialog } from './CreateMissingSideDialog.js';

describe('<CreateMissingSideDialog />', () => {
  const baseProps = {
    target: 'notes.md',
    destinationPath: '/folderA/notes.md',
    sourcePath: '/folderB/notes.md',
  };

  it('renders the title and source/destination paths for "Create left file"', () => {
    render(
      <CreateMissingSideDialog
        {...baseProps}
        direction="rightToLeft"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Create left file' })).toBeInTheDocument();
    expect(screen.getByText('notes.md')).toBeInTheDocument();
    expect(screen.getByText(/\/folderA\/notes\.md/)).toBeInTheDocument();
    expect(screen.getByText(/\/folderB\/notes\.md/)).toBeInTheDocument();
  });

  it('renders "Create right file" when the direction is leftToRight', () => {
    render(
      <CreateMissingSideDialog
        {...baseProps}
        direction="leftToRight"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Create right file' })).toBeInTheDocument();
  });

  it('invokes onConfirm when Create is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <CreateMissingSideDialog
        {...baseProps}
        direction="rightToLeft"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('invokes onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    render(
      <CreateMissingSideDialog
        {...baseProps}
        direction="rightToLeft"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('invokes onCancel when the backdrop is clicked', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <CreateMissingSideDialog
        {...baseProps}
        direction="leftToRight"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector('.awapi-modal__backdrop');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
