import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusBar } from './StatusBar.js';
import { emptyDiffSummary } from '../diffSummary.js';

function summaryWithErrors(count: number): ReturnType<typeof emptyDiffSummary> {
  const s = emptyDiffSummary();
  s.error = count;
  s.total = count;
  return s;
}

describe('<StatusBar />', () => {
  it('disables the error chip when there are no errors', () => {
    render(
      <StatusBar summary={emptyDiffSummary()} scanning={false} theme="light" />,
    );
    const button = screen.getByRole('button', { name: /Error: 0/ });
    expect(button).toBeDisabled();
    expect(screen.queryByTestId('status-error-popover')).toBeNull();
  });

  it('opens a popover with error details when the chip is clicked', async () => {
    render(
      <StatusBar
        summary={summaryWithErrors(2)}
        scanning={false}
        theme="light"
        errors={[
          { relPath: 'foo/bar.txt', message: 'permission denied' },
          { relPath: 'baz.bin', message: '' },
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: /Error: 2/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(button);

    const popover = screen.getByTestId('status-error-popover');
    expect(popover).toBeInTheDocument();
    expect(popover).toHaveTextContent('2 errors');
    expect(popover).toHaveTextContent('foo/bar.txt');
    expect(popover).toHaveTextContent('permission denied');
    expect(popover).toHaveTextContent('baz.bin');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles the popover closed on a second click', async () => {
    render(
      <StatusBar
        summary={summaryWithErrors(1)}
        scanning={false}
        theme="light"
        errors={[{ relPath: 'a.txt', message: 'boom' }]}
      />,
    );
    const button = screen.getByRole('button', { name: /Error: 1/ });
    await userEvent.click(button);
    expect(screen.getByTestId('status-error-popover')).toBeInTheDocument();
    await userEvent.click(button);
    expect(screen.queryByTestId('status-error-popover')).toBeNull();
  });

  it('truncates very long error lists and notes the remainder', async () => {
    const errors = Array.from({ length: 60 }, (_, i) => ({
      relPath: `path/${i}`,
      message: 'boom',
    }));
    render(
      <StatusBar
        summary={summaryWithErrors(60)}
        scanning={false}
        theme="light"
        errors={errors}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Error: 60/ }));
    const popover = screen.getByTestId('status-error-popover');
    expect(popover).toHaveTextContent('60 errors');
    expect(popover).toHaveTextContent('… and 10 more');
  });

  it('closes the popover when Escape is pressed', async () => {
    render(
      <StatusBar
        summary={summaryWithErrors(1)}
        scanning={false}
        theme="light"
        errors={[{ relPath: 'a.txt', message: 'boom' }]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Error: 1/ }));
    expect(screen.getByTestId('status-error-popover')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('status-error-popover')).toBeNull();
  });
});
