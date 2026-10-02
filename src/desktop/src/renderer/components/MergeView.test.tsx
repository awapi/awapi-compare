import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { merge3 } from '@awapi/shared';

import { MergeView, type MergeViewActions, type MergeViewProps } from './MergeView.js';
import { createFakeMonaco, type FakeMonaco } from '../test-stubs/mergeFakeMonaco.js';

const L = (s: string): string[] => s.split(' ');
const labels = { base: 'base.txt', left: 'left.txt', right: 'right.txt', output: 'out.txt' };

/** Two conflicts (lines 2 and 5) and one left-only change (line 7). */
function sample() {
  return merge3(L('a b c d e f g h'), L('a L c d E1 f G h'), L('a R c d E2 f g h'));
}

async function mount(overrides: Partial<MergeViewProps> = {}) {
  const monaco = createFakeMonaco();
  const actionsRef: { current: MergeViewActions | null } = { current: null };
  const onDirtyChange = vi.fn();
  const utils = render(
    <MergeView
      merge={sample()}
      eol={'\n'}
      finalNewline
      language="plaintext"
      labels={labels}
      actionsRef={actionsRef}
      onDirtyChange={onDirtyChange}
      monacoLoader={async () => monaco}
      {...overrides}
    />,
  );
  await waitFor(() => expect(monaco.editors).toHaveLength(4));
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Change/));
  return { monaco, actionsRef, onDirtyChange, ...utils };
}

function resultLines(monaco: FakeMonaco): string[] {
  return monaco.models[3]!.getValue().split('\n').slice(0, -1);
}

describe('MergeView', () => {
  it('shows the four panes with their labels and the merged result with conflict markers', async () => {
    const { monaco } = await mount();
    expect(screen.getByText('Left: left.txt')).toBeTruthy();
    expect(screen.getByText('Base: base.txt')).toBeTruthy();
    expect(screen.getByText('Right: right.txt')).toBeTruthy();
    expect(screen.getByText('Result: out.txt')).toBeTruthy();
    expect(monaco.pane('left').options['readOnly']).toBe(true);
    expect(monaco.pane('result').options['readOnly']).toBeUndefined();
    expect(resultLines(monaco)).toEqual([
      'a',
      '<<<<<<< left',
      'L',
      '=======',
      'R',
      '>>>>>>> right',
      'c',
      'd',
      '<<<<<<< left',
      'E1',
      '=======',
      'E2',
      '>>>>>>> right',
      'f',
      'G',
      'h',
    ]);
    expect(screen.getByRole('status').textContent).toBe('Change 1 of 3 · 2 unresolved conflicts');
  });

  it('selects and reveals the first conflict in every pane', async () => {
    const { monaco } = await mount();
    expect(monaco.pane('left').revealed.at(-1)).toBe(2);
    expect(monaco.pane('right').revealed.at(-1)).toBe(2);
    expect(monaco.pane('result').revealed.at(-1)).toBe(2);
  });

  it('highlights regions by kind and marks the current one', async () => {
    const { monaco } = await mount();
    const classes = monaco.pane('left').collections[0]!.decorations.map((d) => d.options.className);
    expect(classes[0]).toContain('awapi-merge__region--conflict');
    expect(classes[0]).toContain('awapi-merge__region--current');
    expect(classes[2]).toContain('awapi-merge__region--left');
    expect(classes[2]).not.toContain('--current');
  });

  it('resolves the current conflict with each choice', async () => {
    const { monaco, onDirtyChange } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Take right' }));
    expect(resultLines(monaco).slice(0, 4)).toEqual(['a', 'R', 'c', 'd']);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('status').textContent).toBe('Change 1 of 3 · 1 unresolved conflict');

    fireEvent.click(screen.getByRole('button', { name: 'Take left' }));
    expect(resultLines(monaco).slice(0, 4)).toEqual(['a', 'L', 'c', 'd']);

    fireEvent.click(screen.getByRole('button', { name: 'Take base' }));
    expect(resultLines(monaco).slice(0, 4)).toEqual(['a', 'b', 'c', 'd']);

    fireEvent.click(screen.getByRole('button', { name: 'Left + right' }));
    expect(resultLines(monaco).slice(0, 5)).toEqual(['a', 'L', 'R', 'c', 'd']);

    fireEvent.click(screen.getByRole('button', { name: 'Right + left' }));
    expect(resultLines(monaco).slice(0, 5)).toEqual(['a', 'R', 'L', 'c', 'd']);
    expect(monaco.pane('result').undoStops.length).toBeGreaterThan(0);
  });

  it('keeps later regions tracked after an earlier one changes size', async () => {
    const { monaco, actionsRef } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Take left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next conflict' }));
    fireEvent.click(screen.getByRole('button', { name: 'Left + right' }));
    expect(resultLines(monaco)).toEqual(['a', 'L', 'c', 'd', 'E1', 'E2', 'f', 'G', 'h']);
    expect(screen.getByRole('status').textContent).toBe('Change 2 of 3 · all conflicts resolved');
    expect(actionsRef.current?.getUnresolvedCount()).toBe(0);
    expect(actionsRef.current?.getResultText()).toBe('a\nL\nc\nd\nE1\nE2\nf\nG\nh\n');
  });

  it('can revert a one-sided change to the base', async () => {
    const { monaco } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Next change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next change' }));
    expect(screen.getByRole('status').textContent).toMatch(/^Change 3 of 3/);
    fireEvent.click(screen.getByRole('button', { name: 'Take base' }));
    expect(resultLines(monaco).slice(-3)).toEqual(['f', 'g', 'h']);
  });

  it('steps through changes and conflicts, wrapping around', async () => {
    await mount();
    const status = (): string => screen.getByRole('status').textContent ?? '';
    fireEvent.click(screen.getByRole('button', { name: 'Next change' }));
    expect(status()).toMatch(/^Change 2 of 3/);
    fireEvent.click(screen.getByRole('button', { name: 'Previous change' }));
    expect(status()).toMatch(/^Change 1 of 3/);
    fireEvent.click(screen.getByRole('button', { name: 'Previous change' }));
    expect(status()).toMatch(/^Change 3 of 3/);
    fireEvent.click(screen.getByRole('button', { name: 'Next conflict' }));
    expect(status()).toMatch(/^Change 1 of 3/);
    fireEvent.click(screen.getByRole('button', { name: 'Previous conflict' }));
    expect(status()).toMatch(/^Change 2 of 3/);
  });

  it('supports F7 / Shift+F7', async () => {
    const { container } = await mount();
    const root = container.querySelector('.awapi-merge') as HTMLElement;
    fireEvent.keyDown(root, { key: 'F7' });
    expect(screen.getByRole('status').textContent).toMatch(/^Change 2 of 3/);
    fireEvent.keyDown(root, { key: 'F7', shiftKey: true });
    expect(screen.getByRole('status').textContent).toMatch(/^Change 1 of 3/);
    fireEvent.keyDown(root, { key: 'a' });
    expect(screen.getByRole('status').textContent).toMatch(/^Change 1 of 3/);
  });

  it('follows the caret between regions in the result and the other panes', async () => {
    const { monaco } = await mount();
    act(() => monaco.pane('result').moveCursor(9)); // inside the second conflict
    expect(screen.getByRole('status').textContent).toMatch(/^Change 2 of 3/);
    act(() => monaco.pane('result').moveCursor(3)); // first conflict again
    expect(screen.getByRole('status').textContent).toMatch(/^Change 1 of 3/);
    act(() => monaco.pane('left').moveCursor(7)); // left-only region (line 7)
    expect(screen.getByRole('status').textContent).toMatch(/^Change 3 of 3/);
    act(() => monaco.pane('base').moveCursor(1)); // stable line: no change
    expect(screen.getByRole('status').textContent).toMatch(/^Change 3 of 3/);
  });

  it('tracks manual edits: dirty state, marker-based unresolved count and save baseline', async () => {
    const { monaco, actionsRef, onDirtyChange } = await mount();
    const model = monaco.models[3]!;
    // User deletes the first conflict's markers by hand.
    act(() => {
      monaco.pane('result').executeEdits('test', [
        {
          range: { startLineNumber: 2, startColumn: 1, endLineNumber: 7, endColumn: 1 },
          text: 'hand-merged\n',
        },
      ]);
    });
    expect(model.getValue().startsWith('a\nhand-merged\nc\n')).toBe(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(actionsRef.current?.getUnresolvedCount()).toBe(1);

    actionsRef.current?.markSaved();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    actionsRef.current?.markSaved(); // already clean: no extra callback
    expect(onDirtyChange.mock.calls.filter((c) => c[0] === false)).toHaveLength(1);
  });

  it('applies the original EOL style and final newline to the saved text', async () => {
    const monaco = createFakeMonaco();
    const actionsRef: { current: MergeViewActions | null } = { current: null };
    render(
      <MergeView
        merge={merge3(L('a b'), L('a b'), L('a b'))}
        eol={'\r\n'}
        finalNewline={false}
        language="plaintext"
        labels={labels}
        actionsRef={actionsRef}
        monacoLoader={async () => monaco}
      />,
    );
    await waitFor(() => expect(actionsRef.current).not.toBeNull());
    expect(actionsRef.current?.getResultText()).toBe('a\r\nb');
    expect(screen.getByRole('status').textContent).toBe('No differences');
    for (const name of ['Take left', 'Next change', 'Next conflict']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('handles deletions (empty regions) when taking sides', async () => {
    const monaco = createFakeMonaco();
    render(
      <MergeView
        merge={merge3(L('a b c'), L('a c'), L('a X c'))}
        eol={'\n'}
        finalNewline
        language="plaintext"
        labels={labels}
        monacoLoader={async () => monaco}
      />,
    );
    await waitFor(() => expect(monaco.editors).toHaveLength(4));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Change/));
    fireEvent.click(screen.getByRole('button', { name: 'Take left' }));
    expect(monaco.models[3]!.getValue()).toBe('a\nc\n');
    fireEvent.click(screen.getByRole('button', { name: 'Take right' }));
    expect(monaco.models[3]!.getValue()).toBe('a\nX\nc\n');
  });

  it('shows an error when the editor fails to load', async () => {
    render(
      <MergeView
        merge={sample()}
        eol={'\n'}
        finalNewline
        language="plaintext"
        labels={labels}
        monacoLoader={async () => {
          throw new Error('no monaco');
        }}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toContain('no monaco');
  });

  it('disposes editors and models on unmount and clears the actions handle', async () => {
    const { monaco, actionsRef, unmount, onDirtyChange } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Take left' }));
    unmount();
    expect(monaco.editors.every((e) => e.disposed)).toBe(true);
    expect(monaco.models.every((m) => m.disposed)).toBe(true);
    expect(actionsRef.current).toBeNull();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});
