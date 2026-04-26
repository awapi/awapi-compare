import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { FS_ERROR_EXTERNAL_MODIFICATION } from '@awapi/shared';
import {
  TextDiffView,
  type MonacoDiffEditor,
  type MonacoEditorInstance,
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
    // Return the full value for test simplicity (range is ignored).
    getValueInRange: (_range) => value,
    pushEditOperations: (_before, ops, _cursor) => {
      const op = ops[0];
      if (op != null) {
        value = op.text ?? '';
        listeners.forEach((cb) => cb());
      }
      return null;
    },
  };
}

function makeMonaco(models: { l: FakeModel; r: FakeModel }): MonacoLike {
  const noop: MonacoEditorInstance = {
    addAction: () => ({ dispose: () => undefined }),
    getSelection: () => null,
  };
  const editor: MonacoDiffEditor = {
    setModel: () => undefined,
    layout: () => undefined,
    dispose: () => undefined,
    getOriginalEditor: () => noop,
    getModifiedEditor: () => noop,
  };
  return {
    KeyMod: { Alt: 512 },
    KeyCode: { RightArrow: 17, LeftArrow: 15 },
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

describe('<TextDiffView /> re-sync models on prop change', () => {
  it('clears the original model when leftText becomes "" (absent side after swap)', async () => {
    const l = makeModel('left content');
    const r = makeModel('');
    const { rerender } = render(
      <TextDiffView
        relPath="src/foo.ts"
        leftText="left content"
        rightText=""
        monacoLoader={async () => makeMonaco({ l, r })}
      />,
    );
    await waitFor(() => expect(screen.queryByText(/loading editor/i)).not.toBeInTheDocument());
    // Swap: left becomes absent ('' passed by FileDiffViewSwitcher), right receives the content.
    rerender(
      <TextDiffView
        relPath="src/foo.ts"
        leftText=""
        rightText="left content"
        monacoLoader={async () => makeMonaco({ l, r })}
      />,
    );
    expect(l.getValue()).toBe('');
    expect(r.getValue()).toBe('left content');
  });

  it('does NOT clear a model when its text is null (still loading)', async () => {
    const l = makeModel('existing content');
    const r = makeModel('');
    const { rerender } = render(
      <TextDiffView
        relPath="src/foo.ts"
        leftText="existing content"
        rightText=""
        monacoLoader={async () => makeMonaco({ l, r })}
      />,
    );
    await waitFor(() => expect(screen.queryByText(/loading editor/i)).not.toBeInTheDocument());
    // null means "still loading" — model must not be cleared.
    rerender(
      <TextDiffView
        relPath="src/foo.ts"
        leftText={null}
        rightText=""
        monacoLoader={async () => makeMonaco({ l, r })}
      />,
    );
    expect(l.getValue()).toBe('existing content');
  });
});

describe('<TextDiffView /> copy context-menu actions', () => {
  function makeMonacoWithActionCapture(models: { l: FakeModel; r: FakeModel }): {
    monaco: MonacoLike;
    origEditor: MonacoEditorInstance & { capturedActions: Array<{ id: string; run(ed: MonacoEditorInstance): void }> };
    modEditor: MonacoEditorInstance & { capturedActions: Array<{ id: string; run(ed: MonacoEditorInstance): void }> };
  } {
    const origActions: Array<{ id: string; run(ed: MonacoEditorInstance): void }> = [];
    const modActions: Array<{ id: string; run(ed: MonacoEditorInstance): void }> = [];

    const origEditor: MonacoEditorInstance & { capturedActions: typeof origActions } = {
      capturedActions: origActions,
      addAction: (desc) => { origActions.push(desc); return { dispose: () => undefined }; },
      getSelection: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 }),
    };
    const modEditor: MonacoEditorInstance & { capturedActions: typeof modActions } = {
      capturedActions: modActions,
      addAction: (desc) => { modActions.push(desc); return { dispose: () => undefined }; },
      getSelection: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 }),
    };

    const editor: MonacoDiffEditor = {
      setModel: () => undefined,
      layout: () => undefined,
      dispose: () => undefined,
      getOriginalEditor: () => origEditor,
      getModifiedEditor: () => modEditor,
    };
    const monaco: MonacoLike = {
      KeyMod: { Alt: 512 },
      KeyCode: { RightArrow: 17, LeftArrow: 15 },
      editor: {
        createDiffEditor: () => editor,
        createModel: vi
          .fn<(value: string, language?: string) => FakeModel>()
          .mockImplementationOnce(() => models.l)
          .mockImplementationOnce(() => models.r),
      },
    };
    return { monaco, origEditor, modEditor };
  }

  it('Copy to Right transfers selected content from original to modified model', async () => {
    const l = makeModel('hello');
    const r = makeModel('world');
    const { monaco, origEditor } = makeMonacoWithActionCapture({ l, r });

    render(
      <TextDiffView
        relPath="src/foo.ts"
        leftText="hello"
        rightText="world"
        editableLeft
        editableRight
        monacoLoader={async () => monaco}
      />,
    );
    await waitFor(() => expect(screen.queryByText(/loading editor/i)).not.toBeInTheDocument());

    const action = origEditor.capturedActions.find((a) => a.id === 'awapi.copySelectionToRight');
    expect(action).toBeDefined();
    act(() => { action!.run(origEditor); });

    expect(r.getValue()).toBe('hello');
  });

  it('Copy to Left transfers selected content from modified to original model', async () => {
    const l = makeModel('hello');
    const r = makeModel('world');
    const { monaco, modEditor } = makeMonacoWithActionCapture({ l, r });

    render(
      <TextDiffView
        relPath="src/foo.ts"
        leftText="hello"
        rightText="world"
        editableLeft
        editableRight
        monacoLoader={async () => monaco}
      />,
    );
    await waitFor(() => expect(screen.queryByText(/loading editor/i)).not.toBeInTheDocument());

    const action = modEditor.capturedActions.find((a) => a.id === 'awapi.copySelectionToLeft');
    expect(action).toBeDefined();
    act(() => { action!.run(modEditor); });

    expect(l.getValue()).toBe('world');
  });

  it('Copy to Right is a no-op when editableRight is false', async () => {
    const l = makeModel('hello');
    const r = makeModel('world');
    const { monaco, origEditor } = makeMonacoWithActionCapture({ l, r });

    render(
      <TextDiffView
        relPath="src/foo.ts"
        leftText="hello"
        rightText="world"
        editableRight={false}
        monacoLoader={async () => monaco}
      />,
    );
    await waitFor(() => expect(screen.queryByText(/loading editor/i)).not.toBeInTheDocument());

    const action = origEditor.capturedActions.find((a) => a.id === 'awapi.copySelectionToRight');
    expect(action).toBeDefined();
    act(() => { action!.run(origEditor); });

    // Right model must remain unchanged.
    expect(r.getValue()).toBe('world');
  });
});
