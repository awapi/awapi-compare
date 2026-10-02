import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FS_ERROR_EXTERNAL_MODIFICATION } from '@awapi/shared';

import { MergeTab } from './MergeTab.js';
import { useWorkspaceStore } from '../state/stores.js';
import { getTabSaveHandler } from '../state/tabSaveRegistry.js';
import { createFakeMonaco, type FakeMonaco } from '../test-stubs/mergeFakeMonaco.js';
import type { MergeFsApi } from '../mergeFiles.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const FILES: Record<string, string> = {
  '/base.txt': 'a\nb\nc\n',
  '/left.txt': 'a\nL\nc\n',
  '/right.txt': 'a\nR\nc\n',
  '/out.txt': 'old\n',
};

function makeFs(files: Record<string, string> = FILES) {
  const write = vi.fn(async (_req: unknown) => undefined);
  const fs: MergeFsApi = {
    read: async ({ path }) => {
      const f = files[path];
      if (f === undefined) throw new Error(`ENOENT ${path}`);
      const data = enc(f);
      return { data, size: data.length, mtimeMs: 100 };
    },
    stat: async () => ({ size: 1, mtimeMs: 200, type: 'file' }),
    write: write as MergeFsApi['write'],
  };
  return { fs, write };
}

const paths = { base: '/base.txt', left: '/left.txt', right: '/right.txt', output: '/out.txt' };

let monaco: FakeMonaco;
let tabId: string;

async function mountTab(
  initial: Parameters<typeof MergeTab>[0]['initialPaths'] = paths,
  files?: Record<string, string>,
) {
  const { fs, write } = makeFs(files);
  tabId = useWorkspaceStore.getState().openMergeTab(initial);
  const utils = render(
    <MergeTab tabId={tabId} initialPaths={initial} fsApi={fs} monacoLoader={async () => monaco} />,
  );
  return { fs, write, ...utils };
}

async function untilLoaded(): Promise<void> {
  await waitFor(() => expect(monaco.editors).toHaveLength(4));
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Change/));
}

const tabState = () => useWorkspaceStore.getState().tabs.find((t) => t.id === tabId);

beforeEach(() => {
  monaco = createFakeMonaco();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { awapi?: unknown }).awapi;
  useWorkspaceStore.setState({
    tabs: useWorkspaceStore.getState().tabs.filter((t) => t.kind === 'compare'),
  });
});

describe('<MergeTab />', () => {
  it('auto-loads when opened with both sides and titles the tab after the output', async () => {
    await mountTab();
    await untilLoaded();
    expect(screen.getByText('Result: out.txt')).toBeTruthy();
    expect(tabState()?.title).toBe('Merge: out.txt');
    expect((screen.getByRole('button', { name: 'Reload' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('waits for the user when paths are missing, then loads on demand', async () => {
    await mountTab({});
    expect(screen.getByText(/press\s+Load/i)).toBeTruthy();
    const load = screen.getByRole('button', { name: 'Load' }) as HTMLButtonElement;
    expect(load.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Left file path'), { target: { value: '/left.txt' } });
    fireEvent.change(screen.getByLabelText('Right file path'), { target: { value: '/right.txt' } });
    expect(load.disabled).toBe(false);
    fireEvent.keyDown(screen.getByLabelText('Right file path'), { key: 'Enter' });
    await untilLoaded();
    // No base and no output path: result pane is labelled accordingly.
    expect(screen.getByText('Base: (empty)')).toBeTruthy();
    expect(screen.getByText('Result: (not set)')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Save result' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows load errors', async () => {
    await mountTab({ ...paths, base: '/missing.txt' });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Base: ENOENT/);
    expect(monaco.editors).toHaveLength(0);
  });

  it('saves the resolved result and clears the dirty marker', async () => {
    const { write } = await mountTab();
    await untilLoaded();
    expect(tabState()?.dirty).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Take right' }));
    await waitFor(() => expect(tabState()?.dirty).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith({
      path: '/out.txt',
      contents: 'a\nR\nc\n',
      encoding: 'utf8',
      expectedMtimeMs: 100,
    });
    await waitFor(() => expect(tabState()?.dirty).toBeUndefined());

    // The next save is guarded with the mtime reported after the first write.
    fireEvent.click(screen.getByRole('button', { name: 'Take left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1]?.[0]).toMatchObject({ contents: 'a\nL\nc\n', expectedMtimeMs: 200 });
  });

  it('asks before saving with unresolved conflicts', async () => {
    const { write } = await mountTab();
    await untilLoaded();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]?.[0]).toMatch(/1 conflict still unresolved/);
    expect(write).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect((write.mock.calls[0]?.[0] as { contents: string }).contents).toContain('<<<<<<< left');
  });

  it('offers to overwrite after an external modification', async () => {
    const { write } = await mountTab();
    await untilLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Take left' }));
    write.mockRejectedValueOnce(
      Object.assign(new Error('changed'), { code: FS_ERROR_EXTERNAL_MODIFICATION }),
    );

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/external modification/);
    expect(write).toHaveBeenCalledTimes(1);

    write.mockRejectedValueOnce(
      Object.assign(new Error('changed'), { code: FS_ERROR_EXTERNAL_MODIFICATION }),
    );
    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(3));
    expect(write.mock.calls[2]?.[0]).not.toHaveProperty('expectedMtimeMs');
  });

  it('surfaces write failures', async () => {
    const { write } = await mountTab();
    await untilLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Take left' }));
    write.mockRejectedValueOnce(new Error('disk full'));
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    expect((await screen.findByRole('alert')).textContent).toBe('disk full');
  });

  it('registers a save handler for the close flow', async () => {
    const { write } = await mountTab();
    await untilLoaded();
    const handler = getTabSaveHandler(tabId);
    expect(handler).toBeDefined();

    await act(async () => {
      await handler?.(); // clean: nothing to write
    });
    expect(write).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Take left' }));
    await act(async () => {
      await handler?.();
    });
    expect(write).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Take right' }));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    write.mockRejectedValueOnce(new Error('nope'));
    await expect(
      act(async () => {
        await handler?.();
      }),
    ).rejects.toThrow(/not saved/);
  });

  it('unregisters the handler and clears the dirty flag on unmount', async () => {
    const { unmount } = await mountTab();
    await untilLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Take left' }));
    await waitFor(() => expect(tabState()?.dirty).toBe(true));
    unmount();
    expect(getTabSaveHandler(tabId)).toBeUndefined();
    expect(tabState()?.dirty).toBeUndefined();
  });

  it('confirms before a reload discards edits', async () => {
    await mountTab();
    await untilLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Take left' }));
    await waitFor(() => expect(tabState()?.dirty).toBe(true));

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(monaco.editors).toHaveLength(4);

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(monaco.editors).toHaveLength(8));
  });

  it('fills a path from the native file picker', async () => {
    const pickFile = vi.fn(async () => '/picked.txt');
    (window as unknown as { awapi: unknown }).awapi = { dialog: { pickFile } };
    await mountTab({});
    fireEvent.click(screen.getByRole('button', { name: 'Browse for base file' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Base file path') as HTMLInputElement).value).toBe(
        '/picked.txt',
      ),
    );
    expect(pickFile).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/base/i) }),
    );
  });

  it('reports a missing filesystem bridge', async () => {
    tabId = useWorkspaceStore.getState().openMergeTab(paths);
    render(<MergeTab tabId={tabId} initialPaths={paths} monacoLoader={async () => monaco} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/filesystem bridge/);
  });
});
