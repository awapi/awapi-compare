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
    await userEvent.type(screen.getByLabelText(/left folder/i), '/x');
    expect(handlers.onLeftRootChange).toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/right folder/i), '/y');
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
});
