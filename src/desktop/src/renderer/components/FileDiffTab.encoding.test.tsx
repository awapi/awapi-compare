import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { encodeText } from '@awapi/shared';
import { FileDiffTab } from './FileDiffTab.js';
import type { TextDiffViewProps } from './TextDiffView.js';

// Replace the Monaco-backed view with a probe that records its latest props.
let latest: TextDiffViewProps | null = null;
vi.mock('./TextDiffView.js', () => ({
  TextDiffView: (props: TextDiffViewProps) => {
    latest = props;
    return <div data-testid="text-diff-probe" />;
  },
}));

const write = vi.fn();

function installApi(files: Record<string, Uint8Array>) {
  (window as unknown as { awapi: unknown }).awapi = {
    fs: {
      stat: async ({ path }: { path: string }) => {
        const f = files[path];
        if (!f) throw new Error('ENOENT');
        return { size: f.length, mtimeMs: 42, type: 'file' };
      },
      read: async ({ path }: { path: string }) => {
        const f = files[path]!;
        return { data: f, size: f.length, mtimeMs: 42 };
      },
      write,
    },
  };
}

async function mountTab(files: Record<string, Uint8Array>) {
  installApi(files);
  render(<FileDiffTab relPath="a.txt" initialLeftPath="/l.txt" initialRightPath="/r.txt" />);
  await waitFor(() => expect(latest?.leftText).not.toBeNull());
  await waitFor(() => expect(latest?.rightText).not.toBeNull());
  await waitFor(() => expect(screen.getByTestId('text-diff-probe')).toBeInTheDocument());
}

const utf8 = (s: string) => new TextEncoder().encode(s);

beforeEach(() => {
  latest = null;
  write.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  delete (window as unknown as { awapi?: unknown }).awapi;
});

describe('<FileDiffTab /> encoding-aware load and save', () => {
  it('passes the detected encodings to the text view', async () => {
    await mountTab({
      '/l.txt': encodeText('hi', 'utf-16le').bytes,
      '/r.txt': utf8('hi'),
    });
    expect(latest?.leftEncoding).toBe('utf-16le');
    expect(latest?.rightEncoding).toBe('utf-8');
    expect(latest?.leftText).toBe('hi');
  });

  it('saves plain UTF-8 as a string (unchanged behaviour)', async () => {
    await mountTab({ '/l.txt': utf8('a'), '/r.txt': utf8('b') });
    await act(async () => {
      await latest!.onSave?.('right', 'b2');
    });
    expect(write).toHaveBeenCalledWith({
      path: '/r.txt',
      contents: 'b2',
      encoding: 'utf8',
      expectedMtimeMs: 42,
    });
  });

  it('re-encodes a UTF-16 file as UTF-16 (with BOM) when saving', async () => {
    await mountTab({ '/l.txt': encodeText('a', 'utf-16le').bytes, '/r.txt': utf8('b') });
    await act(async () => {
      await latest!.onSave?.('left', 'hi');
    });
    const arg = write.mock.calls[0]![0] as { contents: Uint8Array; encoding: string };
    expect(arg.encoding).toBe('binary');
    expect(Array.from(arg.contents)).toEqual([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
  });

  it('preserves a UTF-8 BOM on save', async () => {
    await mountTab({
      '/l.txt': encodeText('a', 'utf-8-bom').bytes,
      '/r.txt': utf8('b'),
    });
    await act(async () => {
      await latest!.onSave?.('left', 'hi');
    });
    const arg = write.mock.calls[0]![0] as { contents: Uint8Array };
    expect(Array.from(arg.contents)).toEqual([0xef, 0xbb, 0xbf, 0x68, 0x69]);
  });

  it('treats picking a different encoding as an unsaved change and saves with it', async () => {
    await mountTab({ '/l.txt': utf8('a'), '/r.txt': utf8('b') });
    const saveLeft = screen.getByRole('button', { name: 'Save left' });
    expect(saveLeft).toBeDisabled();

    act(() => latest!.onEncodingChange?.('left', 'utf-16be'));
    await waitFor(() => expect(saveLeft).toBeEnabled());
    expect(latest?.leftEncoding).toBe('utf-16be');

    await act(async () => {
      await latest!.onSave?.('left', 'a');
    });
    const arg = write.mock.calls[0]![0] as { contents: Uint8Array };
    expect(Array.from(arg.contents)).toEqual([0xfe, 0xff, 0x00, 0x61]);
    // Once written, the pick is no longer a pending change.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save left' })).toBeDisabled());
  });

  it('picking back the detected encoding clears the pending change', async () => {
    await mountTab({ '/l.txt': utf8('a'), '/r.txt': utf8('b') });
    act(() => latest!.onEncodingChange?.('left', 'windows-1252'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save left' })).toBeEnabled());
    act(() => latest!.onEncodingChange?.('left', 'utf-8'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save left' })).toBeDisabled());
  });

  it('refuses to save lossy text and reports why', async () => {
    await mountTab({ '/l.txt': utf8('a'), '/r.txt': utf8('b') });
    act(() => latest!.onEncodingChange?.('right', 'windows-1252'));
    await act(async () => {
      await latest!.onSave?.('right', 'snowman \u2603');
    });
    expect(write).not.toHaveBeenCalled();
    expect(await screen.findByText(/cannot save as windows-1252/i)).toBeInTheDocument();
  });

  it('forgets an encoding pick when the side is pointed at another file', async () => {
    await mountTab({ '/l.txt': utf8('a'), '/r.txt': utf8('b'), '/other.txt': utf8('c') });
    act(() => latest!.onEncodingChange?.('left', 'utf-16le'));
    await waitFor(() => expect(latest?.leftEncoding).toBe('utf-16le'));
    fireEvent.change(screen.getByLabelText('Left file'), { target: { value: '/other.txt' } });
    await waitFor(() => expect(latest?.leftEncoding).toBe('utf-8'));
  });
});
