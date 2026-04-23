import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextMenu, type ContextMenuItem } from './ContextMenu.js';

const ITEMS: ContextMenuItem[] = [
  { action: 'open', label: 'Open', accelerator: 'F6' },
  { action: 'compare', label: 'Compare', accelerator: 'F5' },
  { action: 'delete', label: 'Delete', disabled: true },
];

describe('<ContextMenu />', () => {
  it('renders every item with its label and accelerator', () => {
    render(
      <ContextMenu x={0} y={0} items={ITEMS} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('menuitem', { name: /open/i })).toHaveTextContent('F6');
    expect(screen.getByRole('menuitem', { name: /compare/i })).toHaveTextContent('F5');
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeDisabled();
  });

  it('positions the menu via fixed coordinates', () => {
    render(
      <ContextMenu x={120} y={45} items={ITEMS} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const menu = screen.getByTestId('context-menu');
    expect(menu).toHaveStyle({ position: 'fixed', top: '45px', left: '120px' });
  });

  it('selecting an enabled item invokes onSelect', async () => {
    const onSelect = vi.fn();
    render(
      <ContextMenu x={0} y={0} items={ITEMS} onSelect={onSelect} onClose={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('menuitem', { name: /open/i }));
    expect(onSelect).toHaveBeenCalledWith('open');
  });

  it('disabled items do not fire onSelect', async () => {
    const onSelect = vi.fn();
    render(
      <ContextMenu x={0} y={0} items={ITEMS} onSelect={onSelect} onClose={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('menuitem', { name: /delete/i }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Escape closes the menu', () => {
    const onClose = vi.fn();
    render(
      <ContextMenu x={0} y={0} items={ITEMS} onSelect={vi.fn()} onClose={onClose} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking outside closes the menu', () => {
    const onClose = vi.fn();
    render(
      <div>
        <button type="button">outside</button>
        <ContextMenu x={0} y={0} items={ITEMS} onSelect={vi.fn()} onClose={onClose} />
      </div>,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: /outside/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
