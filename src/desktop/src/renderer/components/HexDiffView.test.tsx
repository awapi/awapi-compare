import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HexDiffView } from './HexDiffView.js';

describe('<HexDiffView />', () => {
  it('renders a summary line and a row container for two buffers', () => {
    const left = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]); // "hello"
    const right = new Uint8Array([0x68, 0x65, 0x6c, 0x70, 0x21]); // "help!"
    render(<HexDiffView left={left} right={right} />);
    const region = screen.getByRole('region', { name: /hex diff/i });
    expect(region).toBeInTheDocument();
    expect(region.textContent).toMatch(/row/i);
  });

  it('renders even when both sides are absent', () => {
    render(<HexDiffView left={null} right={null} />);
    expect(screen.getByRole('region', { name: /hex diff/i })).toBeInTheDocument();
  });
});
