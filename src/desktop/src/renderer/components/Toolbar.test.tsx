import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from './Toolbar.js';

function renderToolbar(overrides: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  const handlers = {
    onLeftRootChange: vi.fn(),
    onRightRootChange: vi.fn(),
    onModeChange: vi.fn(),
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
  it('disables Refresh while paths are empty', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: /^refresh$/i })).toBeDisabled();
  });

  it('enables Refresh once both paths are set', () => {
    renderToolbar({ leftRoot: '/a', rightRoot: '/b' });
    expect(screen.getByRole('button', { name: /^refresh$/i })).toBeEnabled();
  });

  it('shows "Scanning…" while a scan is in flight', () => {
    renderToolbar({ leftRoot: '/a', rightRoot: '/b', scanning: true });
    expect(screen.getByRole('button', { name: /scanning/i })).toBeDisabled();
  });

  it('forwards typing into the left/right inputs', async () => {
    const handlers = renderToolbar();
    await userEvent.type(screen.getByLabelText('Left folder'), '/x');
    expect(handlers.onLeftRootChange).toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Right folder'), '/y');
    expect(handlers.onRightRootChange).toHaveBeenCalled();
  });

  it('clicking Refresh invokes onRefresh', async () => {
    const handlers = renderToolbar({ leftRoot: '/a', rightRoot: '/b' });
    await userEvent.click(screen.getByRole('button', { name: /^refresh$/i }));
    expect(handlers.onRefresh).toHaveBeenCalled();
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

  it('switches the path-bar labels to "file" when pathLabel="file"', () => {
    renderToolbar({ pathLabel: 'file' });
    expect(screen.getByLabelText('Left file')).toBeInTheDocument();
    expect(screen.getByLabelText('Right file')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /browse for left file/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /browse for right file/i }),
    ).toBeInTheDocument();
  });

  it('pressing Enter in the left path input calls onSubmitPaths', async () => {
    const onSubmitPaths = vi.fn();
    renderToolbar({ leftRoot: '/a', rightRoot: '/b', onSubmitPaths });
    const input = screen.getByLabelText('Left folder');
    input.focus();
    await userEvent.keyboard('{Enter}');
    expect(onSubmitPaths).toHaveBeenCalledTimes(1);
  });

  it('pressing Enter in the right path input calls onSubmitPaths', async () => {
    const onSubmitPaths = vi.fn();
    renderToolbar({ leftRoot: '/a', rightRoot: '/b', onSubmitPaths });
    const input = screen.getByLabelText('Right folder');
    input.focus();
    await userEvent.keyboard('{Enter}');
    expect(onSubmitPaths).toHaveBeenCalledTimes(1);
  });

  it('falls back to onRefresh when onSubmitPaths is not provided', async () => {
    const handlers = renderToolbar({ leftRoot: '/a', rightRoot: '/b' });
    const input = screen.getByLabelText('Left folder');
    input.focus();
    await userEvent.keyboard('{Enter}');
    expect(handlers.onRefresh).toHaveBeenCalledTimes(1);
  });
});
