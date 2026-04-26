import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from './Toolbar.js';

function renderToolbar(overrides: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  const handlers = {
    onLeftRootChange: vi.fn(),
    onRightRootChange: vi.fn(),
    onModeChange: vi.fn(),
    onCompare: vi.fn(),
    onRefresh: vi.fn(),
    onToggleTheme: vi.fn(),
    onOpenRules: vi.fn(),
    onPickLeftFolder: vi.fn(),
    onPickRightFolder: vi.fn(),
  };
  render(
    <Toolbar
      leftRoot=""
      rightRoot=""
      mode="quick"
      scanning={false}
      theme="dark"
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('<Toolbar />', () => {
  it('disables Compare while paths are empty', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: /^compare$/i })).toBeDisabled();
  });

  it('enables Compare once both paths are set', () => {
    renderToolbar({ leftRoot: '/a', rightRoot: '/b' });
    expect(screen.getByRole('button', { name: /^compare$/i })).toBeEnabled();
  });

  it('shows "Scanning…" while a scan is in flight', () => {
    renderToolbar({ leftRoot: '/a', rightRoot: '/b', scanning: true });
    expect(screen.getByRole('button', { name: /scanning/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
  });

  it('forwards typing into the left/right inputs', async () => {
    const handlers = renderToolbar();
    await userEvent.type(screen.getByLabelText('Left folder'), '/x');
    expect(handlers.onLeftRootChange).toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Right folder'), '/y');
    expect(handlers.onRightRootChange).toHaveBeenCalled();
  });

  it('clicking Compare invokes onCompare', async () => {
    const handlers = renderToolbar({ leftRoot: '/a', rightRoot: '/b' });
    await userEvent.click(screen.getByRole('button', { name: /^compare$/i }));
    expect(handlers.onCompare).toHaveBeenCalled();
  });

  it('toggle-theme button reflects current theme', async () => {
    const handlers = renderToolbar({ theme: 'dark' });
    const button = screen.getByRole('button', { name: /toggle theme/i });
    expect(button).toHaveTextContent(/light/i);
    await userEvent.click(button);
    expect(handlers.onToggleTheme).toHaveBeenCalled();
  });

  it('clicking the left folder-picker button calls onPickLeftFolder', async () => {
    const handlers = renderToolbar();
    await userEvent.click(
      screen.getByRole('button', { name: /browse for left folder/i }),
    );
    expect(handlers.onPickLeftFolder).toHaveBeenCalledTimes(1);
  });

  it('clicking the right folder-picker button calls onPickRightFolder', async () => {
    const handlers = renderToolbar();
    await userEvent.click(
      screen.getByRole('button', { name: /browse for right folder/i }),
    );
    expect(handlers.onPickRightFolder).toHaveBeenCalledTimes(1);
  });

  it('disables the folder-picker buttons when no handler is provided', () => {
    render(
      <Toolbar
        leftRoot=""
        rightRoot=""
        mode="quick"
        scanning={false}
        theme="dark"
        onLeftRootChange={vi.fn()}
        onRightRootChange={vi.fn()}
        onModeChange={vi.fn()}
        onCompare={vi.fn()}
        onRefresh={vi.fn()}
        onToggleTheme={vi.fn()}
        onOpenRules={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: /browse for left folder/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /browse for right folder/i }),
    ).toBeDisabled();
  });
});
