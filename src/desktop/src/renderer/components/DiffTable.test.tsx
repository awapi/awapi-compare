import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiffTable } from './DiffTable.js';

function headerFor(label: string) {
  return screen.getByRole('button', { name: label }).closest('[role="columnheader"]');
}

describe('<DiffTable /> column sorting', () => {
  it('cycles ascending → descending → unsorted on header clicks', async () => {
    render(<DiffTable pairs={[]} theme="dark" />);
    const button = screen.getByRole('button', { name: 'Sort by left Size' });
    expect(headerFor('Sort by left Size')).toHaveAttribute('aria-sort', 'none');

    await userEvent.click(button);
    expect(headerFor('Sort by left Size')).toHaveAttribute('aria-sort', 'ascending');

    await userEvent.click(button);
    expect(headerFor('Sort by left Size')).toHaveAttribute('aria-sort', 'descending');

    await userEvent.click(button);
    expect(headerFor('Sort by left Size')).toHaveAttribute('aria-sort', 'none');
  });

  it('sorts one column at a time and tracks the side', async () => {
    render(<DiffTable pairs={[]} theme="dark" />);
    await userEvent.click(screen.getByRole('button', { name: 'Sort by left Size' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sort by right Modified' }));
    expect(headerFor('Sort by left Size')).toHaveAttribute('aria-sort', 'none');
    expect(headerFor('Sort by right Modified')).toHaveAttribute('aria-sort', 'ascending');
    expect(headerFor('Sort by left Modified')).toHaveAttribute('aria-sort', 'none');
  });
});
