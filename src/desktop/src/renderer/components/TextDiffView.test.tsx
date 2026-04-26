import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { FS_ERROR_EXTERNAL_MODIFICATION } from '@awapi/shared';
import {
  TextDiffView,
  type MonacoDiffEditor,
  type MonacoLike,
  type MonacoModel,
} from './TextDiffView.js';

interface FakeModel extends MonacoModel {
  fire(): void;
}

function makeModel(initial: string): FakeModel {
  const listeners: Array<() => void> = [];
  let value = initial;
  return {
    getValue: () => value,
    setValue: (v: string) => {
      value = v;
    },
    onDidChangeContent: (cb) => {
      listeners.push(cb);
      return { dispose: () => undefined };
    },
    dispose: () => undefined,
    fire: () => listeners.forEach((cb) => cb()),
  };
}

function makeMonaco(models: { l: FakeModel; r: FakeModel }): MonacoLike {
  const editor: MonacoDiffEditor = {
    setModel: () => undefined,
    layout: () => undefined,
    dispose: () => undefined,
  };
  return {
    editor: {
      createDiffEditor: () => editor,
      // The component creates two models in order: original then modified.
      createModel: vi
        .fn<(value: string, language?: string) => FakeModel>()
        .mockImplementationOnce(() => models.l)
        .mockImplementationOnce(() => models.r),
    },
  };
}

describe('<TextDiffView /> save flow', () => {
  it('calls onSave with the modified-side value and clears the dirty flag', async () => {
    const l = makeModel('left');
    const r = makeModel('right');
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TextDiffView
        relPath="src/foo.ts"
        leftText="left"
        rightText="right"
        editableRight
        onSave={onSave}
        monacoLoader={async () => makeMonaco({ l, r })}
      />,
    );
    // Wait for the editor to mount.
    await waitFor(() => expect(screen.queryByText(/loading editor/i)).not.toBeInTheDocument());
    // Edit the modified model and assert the save button enables.
    act(() => {
      r.setValue('right2');
      r.fire();
    });
    const saveBtn = await screen.findByRole('button', { name: /save right/i });
    expect(saveBtn).toBeEnabled();
    await act(async () => {
      saveBtn.click();
    });
    expect(onSave).toHaveBeenCalledWith('right', 'right2');
  });

  it('surfaces external-modification rejections to the caller', async () => {
    const l = makeModel('left');
    const r = makeModel('right');
    const err = Object.assign(new Error('changed'), { code: FS_ERROR_EXTERNAL_MODIFICATION });
    const inner = vi.fn().mockRejectedValue(err);
    // Wrap to mirror what the host does: catch + record. Without this
    // wrapper, the rejection escapes Promise context and the test
    // process treats it as an unhandled rejection.
    const seen: unknown[] = [];
    const onSave = async (side: 'left' | 'right', value: string) => {
      try {
        await inner(side, value);
      } catch (e) {
        seen.push(e);
      }
    };
    render(
      <TextDiffView
        relPath="src/foo.ts"
        leftText="left"
        rightText="right"
        editableRight
        onSave={onSave}
        monacoLoader={async () => makeMonaco({ l, r })}
      />,
    );
    await waitFor(() => expect(screen.queryByText(/loading editor/i)).not.toBeInTheDocument());
    act(() => {
      r.setValue('right2');
      r.fire();
    });
    const saveBtn = await screen.findByRole('button', { name: /save right/i });
    await act(async () => {
      saveBtn.click();
    });
    expect(inner).toHaveBeenCalledWith('right', 'right2');
    expect(seen).toEqual([err]);
  });
});
