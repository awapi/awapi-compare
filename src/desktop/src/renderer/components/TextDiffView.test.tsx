import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { FS_ERROR_EXTERNAL_MODIFICATION } from '@awapi/shared';
import {
  TextDiffView,
  type MonacoDiffEditor,
  type MonacoEditorInstance,
  type MonacoLike,
  type MonacoLineChange,
  type MonacoModel,
  type TextDiffActions,
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
    KeyMod: { Alt: 512, CtrlCmd: 2048, Shift: 1024 },
    KeyCode: { RightArrow: 17, LeftArrow: 15, KeyS: 49 },
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
  it('calls onSave with the modified-side value via the actions ref and clears the dirty flag', async () => {
    const l = makeModel('left');
    const r = makeModel('right');
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onDirtyChange = vi.fn();
    const actionsRef = createRef<TextDiffActions | null>() as React.MutableRefObject<
      TextDiffActions | null
    >;
    render(
      <TextDiffView
        relPath="src/foo.ts"
        leftText="left"
        rightText="right"
        editableRight
        onSave={onSave}
        onDirtyChange={onDirtyChange}
        actionsRef={actionsRef}
        monacoLoader={async () => makeMonaco({ l, r })}
      />,
    );
    // Wait for the editor to mount.
    await waitFor(() => expect(screen.queryByText(/loading editor/i)).not.toBeInTheDocument());
    expect(actionsRef.current).not.toBeNull();
    // Edit the modified model and assert dirty bubbled up.
    act(() => {
      r.setValue('right2');
      r.fire();
    });
    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenCalledWith(
        expect.objectContaining({ right: true }),
      );
    });
    await act(async () => {
      await actionsRef.current!.saveRight();
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
    const actionsRef = createRef<TextDiffActions | null>() as React.MutableRefObject<
      TextDiffActions | null
    >;
    render(
      <TextDiffView
        relPath="src/foo.ts"
        leftText="left"
        rightText="right"
        editableRight
        onSave={onSave}
        actionsRef={actionsRef}
        monacoLoader={async () => makeMonaco({ l, r })}
      />,
    );
    await waitFor(() => expect(screen.queryByText(/loading editor/i)).not.toBeInTheDocument());
    act(() => {
      r.setValue('right2');
      r.fire();
    });
    await act(async () => {
      await actionsRef.current!.saveRight();
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
      KeyMod: { Alt: 512, CtrlCmd: 2048, Shift: 1024 },
      KeyCode: { RightArrow: 17, LeftArrow: 15, KeyS: 49 },
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

describe('computeCopyEdit', () => {
  // A line-aware in-memory model rich enough for the copy logic.
  function lineModel(initial: string): MonacoModel {
    let value = initial;
    const lines = (): string[] => value.split('\n');
    return {
      getValue: () => value,
      setValue: (v) => { value = v; },
      onDidChangeContent: () => ({ dispose: () => undefined }),
      dispose: () => undefined,
      getLineCount: () => lines().length,
      getLineMaxColumn: (line) => (lines()[line - 1]?.length ?? 0) + 1,
      getValueInRange: (r) => {
        const ls = lines();
        if (r.startLineNumber === r.endLineNumber) {
          const l = ls[r.startLineNumber - 1] ?? '';
          return l.slice(r.startColumn - 1, r.endColumn - 1);
        }
        const out: string[] = [];
        for (let i = r.startLineNumber; i <= r.endLineNumber; i += 1) {
          const l = ls[i - 1] ?? '';
          if (i === r.startLineNumber) out.push(l.slice(r.startColumn - 1));
          else if (i === r.endLineNumber) out.push(l.slice(0, r.endColumn - 1));
          else out.push(l);
        }
        return out.join('\n');
      },
      pushEditOperations: (_b, ops) => {
        for (const op of ops) {
          const before = (() => {
            const ls = lines();
            const out: string[] = [];
            for (let i = 1; i < op.range.startLineNumber; i += 1) out.push(ls[i - 1] ?? '');
            const startLine = ls[op.range.startLineNumber - 1] ?? '';
            out.push(startLine.slice(0, op.range.startColumn - 1));
            return out.join('\n');
          })();
          const after = (() => {
            const ls = lines();
            const out: string[] = [];
            const endLine = ls[op.range.endLineNumber - 1] ?? '';
            out.push(endLine.slice(op.range.endColumn - 1));
            for (let i = op.range.endLineNumber + 1; i <= ls.length; i += 1) out.push(ls[i - 1] ?? '');
            return out.join('\n');
          })();
          value = before + (op.text ?? '') + after;
        }
        return null;
      },
    };
  }

  function fakeEditor(changes: MonacoLineChange[]): MonacoDiffEditor {
    return {
      setModel: () => undefined,
      layout: () => undefined,
      dispose: () => undefined,
      getOriginalEditor: () => ({ addAction: () => ({ dispose: () => undefined }), getSelection: () => null }),
      getModifiedEditor: () => ({ addAction: () => ({ dispose: () => undefined }), getSelection: () => null }),
      getLineChanges: () => changes,
    };
  }

  it('inserts source lines at the alignment point when the target side has zero lines for the change', async () => {
    // Mirrors the screenshot: right has lines 11 ("prom-client") and 12 ("test")
    // that have no counterpart on the left. Copying right → left should
    // *insert* after left line 9, not overwrite left line 11.
    const { computeCopyEdit } = await import('./TextDiffView.js');
    const left = lineModel(['{', '  "name": "alpha"', '  "fastify": "^4.0.0"', '}'].join('\n'));
    const right = lineModel(
      ['{', '  "name": "alpha"', '  "fastify": "^4.25.0"', '  "prom-client": "^15.0.0"', '  "test": "blabla3"', '}'].join('\n'),
    );
    const editor = fakeEditor([
      // Pure insertion on left side: left has 0 lines, right contributes lines 4..5.
      { originalStartLineNumber: 3, originalEndLineNumber: 0, modifiedStartLineNumber: 4, modifiedEndLineNumber: 5 },
    ]);
    // User's caret is on right line 4 (the "prom-client" line).
    const sel = { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 1 };

    const op = computeCopyEdit(editor, right, left, sel, 'toOriginal');
    expect(op).not.toBeNull();
    left.pushEditOperations([], [op!], () => null);

    expect(left.getValue()).toBe(
      [
        '{',
        '  "name": "alpha"',
        '  "fastify": "^4.0.0"',
        '  "prom-client": "^15.0.0"',
        '  "test": "blabla3"',
        '}',
      ].join('\n'),
    );
  });

  it('replaces the matching block on the target side for a paired modify change', async () => {
    const { computeCopyEdit } = await import('./TextDiffView.js');
    const left = lineModel(['a', 'old1', 'old2', 'b'].join('\n'));
    const right = lineModel(['a', 'NEW', 'b'].join('\n'));
    const editor = fakeEditor([
      { originalStartLineNumber: 2, originalEndLineNumber: 3, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 },
    ]);
    const sel = { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 };

    const op = computeCopyEdit(editor, right, left, sel, 'toOriginal');
    expect(op).not.toBeNull();
    left.pushEditOperations([], [op!], () => null);

    expect(left.getValue()).toBe(['a', 'NEW', 'b'].join('\n'));
  });

  it('returns null when the selection sits on matching content (no diff change)', async () => {
    const { computeCopyEdit } = await import('./TextDiffView.js');
    const left = lineModel('a\nb\nc');
    const right = lineModel('a\nb\nc');
    const editor = fakeEditor([]);
    const sel = { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 };

    expect(computeCopyEdit(editor, left, right, sel, 'toModified')).toBeNull();
  });
});
