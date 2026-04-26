import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImageDiffView, bytesToDataUrl } from './ImageDiffView.js';

describe('<ImageDiffView />', () => {
  it('renders mode buttons and shows "(absent)" when no images are supplied', () => {
    render(<ImageDiffView left={null} right={null} />);
    expect(screen.getByRole('button', { name: /side by side/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /onion skin/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /pixel diff/i })).toBeDisabled();
    const panes = screen.getAllByText('(absent)');
    expect(panes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('bytesToDataUrl', () => {
  it('encodes bytes as a data URL with the given MIME type', () => {
    const url = bytesToDataUrl(new Uint8Array([0x68, 0x69]), 'image/png');
    expect(url).toBe('data:image/png;base64,aGk=');
  });

  it('handles empty input', () => {
    expect(bytesToDataUrl(new Uint8Array(), 'image/jpeg')).toBe('data:image/jpeg;base64,');
  });
});
