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
  it('renders the diff region and the status legend when both sides exist', () => {
    render(<FileDiffTab relPath="src/foo.ts" pair={PAIR} />);
    expect(
      screen.getByRole('region', { name: 'File diff for src/foo.ts' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: /diff status legend/i }),
    ).toBeInTheDocument();
  });

  it('renders a friendly fallback when the pair is missing', () => {
    render(<FileDiffTab relPath="src/missing.ts" />);
    const region = screen.getByLabelText('File diff for src/missing.ts');
    expect(region).toHaveTextContent(/no matching pair/i);
    expect(region).toHaveTextContent('src/missing.ts');
  });

  it('renders the toolbar with file-mode path inputs', () => {
    render(<FileDiffTab relPath="src/foo.ts" pair={PAIR} />);
    expect(screen.getByRole('toolbar', { name: /compare toolbar/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Left file')).toBeInTheDocument();
    expect(screen.getByLabelText('Right file')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /browse for left file/i }),
    ).toBeInTheDocument();
  });
});
