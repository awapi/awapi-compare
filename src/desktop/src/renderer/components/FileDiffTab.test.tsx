import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComparedPair } from '@awapi/shared';
import { FileDiffTab } from './FileDiffTab.js';

const PAIR: ComparedPair = {
  relPath: 'src/foo.ts',
  status: 'different',
  left: {
    relPath: 'src/foo.ts',
    name: 'foo.ts',
    type: 'file',
    size: 1234,
    mtimeMs: Date.UTC(2024, 0, 1, 12, 0, 0),
    mode: 0o644,
  },
  right: {
    relPath: 'src/foo.ts',
    name: 'foo.ts',
    type: 'file',
    size: 4567,
    mtimeMs: Date.UTC(2024, 0, 2, 12, 0, 0),
    mode: 0o644,
  },
};

describe('<FileDiffTab />', () => {
  it('renders both panes with metadata when both sides exist', () => {
    render(<FileDiffTab relPath="src/foo.ts" pair={PAIR} />);
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(
      'File diff for src/foo.ts',
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('src/foo.ts');
    expect(screen.getByLabelText('Left side')).toHaveTextContent('foo.ts');
    expect(screen.getByLabelText('Right side')).toHaveTextContent('foo.ts');
  });

  it('marks absent sides with "(absent)"', () => {
    const leftOnly: ComparedPair = { ...PAIR, status: 'left-only', right: undefined };
    render(<FileDiffTab relPath="src/foo.ts" pair={leftOnly} />);
    expect(screen.getByLabelText('Right side')).toHaveTextContent(/absent/i);
  });

  it('renders a friendly fallback when the pair is missing', () => {
    render(<FileDiffTab relPath="src/missing.ts" />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/no matching pair/i);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('src/missing.ts');
  });
});
