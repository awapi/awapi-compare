import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  TextDiffView,
  computeHunkCopyEdit,
  type MonacoDecoration,
  type MonacoDiffEditor,
  type MonacoEditorInstance,
  type MonacoLike,
  type MonacoLineChange,
  type MonacoModel,
  type MonacoRange,
  type MonacoSingleEditOperation,
} from './TextDiffView.js';
import { DEFAULT_TEXT_COMPARE_OPTIONS, type TextCompareOptions } from '../textCompare.js';

interface FakeModel extends MonacoModel {
  edits: MonacoSingleEditOperation[];
  eol: string;
}

/** Line-aware fake model so hunk classification can read real text. */
function makeModel(initial: string): FakeModel {
  let value = initial;
  const model: FakeModel = {
    edits: [],
    eol: '\n',
    getValue: () => value,
    setValue: (v) => {
      value = v;
    },
    onDidChangeContent: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
    getValueInRange: (r) =>
      value
        .split('\n')
        .slice(r.startLineNumber - 1, r.endLineNumber)
        .join('\n'),
    pushEditOperations: (_b, ops) => {
      model.edits.push(...ops);
      return null;
    },
    getLineCount: () => value.split('\n').length,
    getLineMaxColumn: (line) => (value.split('\n')[line - 1] ?? '').length + 1,
    getEOL: () => model.eol,
    setEOL: vi.fn((seq: number) => {
      model.eol = seq === 1 ? '\r\n' : '\n';
    }),
  };
  return model;
}

interface Harness {
  monaco: MonacoLike;
  editor: MonacoDiffEditor;
  l: FakeModel;
  r: FakeModel;
  updateOptions: ReturnType<typeof vi.fn>;
  fireDiffUpdate(changes: MonacoLineChange[]): void;
  revealed: number[];
  positions: Array<{ lineNumber: number; column: number }>;
  decorations: { original: MonacoDecoration[]; modified: MonacoDecoration[] };
  setCaret(p: { lineNumber: number; column: number } | null): void;
  /** Simulate the user placing the caret / selecting in one editor. */
  select(side: 'original' | 'modified', startLine: number, endLine?: number): void;
}

function makeHarness(left: string, right: string): Harness {
  const l = makeModel(left);
  const r = makeModel(right);
  let changes: MonacoLineChange[] = [];
  let diffCb: (() => void) | null = null;
  const revealed: number[] = [];
  const positions: Array<{ lineNumber: number; column: number }> = [];
  const decorations = { original: [] as MonacoDecoration[], modified: [] as MonacoDecoration[] };
  let caret: { lineNumber: number; column: number } | null = null;
  const updateOptions = vi.fn();
  const cursorCbs: Partial<
    Record<'original' | 'modified', (e: { selection: MonacoRange }) => void>
  > = {};

  const side = (key: 'original' | 'modified'): MonacoEditorInstance => ({
    addAction: () => ({ dispose: () => undefined }),
    getSelection: () => null,
    getPosition: () => caret,
    onDidChangeCursorSelection: (cb) => {
      cursorCbs[key] = cb;
      return { dispose: () => undefined };
    },
    setPosition: (p) => {
      positions.push(p);
      caret = p;
    },
    revealLineInCenter: (line) => revealed.push(line),
    createDecorationsCollection: () => ({
      set: (d) => {
        decorations[key] = d;
      },
      clear: () => {
        decorations[key] = [];
      },
    }),
  });
  const originalSide = side('original');
  const modifiedSide = side('modified');
  const editor: MonacoDiffEditor = {
    setModel: () => undefined,
    layout: () => undefined,
    dispose: () => undefined,
    getOriginalEditor: () => originalSide,
    getModifiedEditor: () => modifiedSide,
    getLineChanges: () => changes,
    onDidUpdateDiff: (cb) => {
      diffCb = cb;
      return { dispose: () => undefined };
    },
    updateOptions,
  };
  const monaco: MonacoLike = {
    KeyMod: { Alt: 512, CtrlCmd: 2048, Shift: 1024 },
    KeyCode: { RightArrow: 17, LeftArrow: 15, KeyS: 49 },
    editor: {
      createDiffEditor: () => editor,
      createModel: vi
        .fn<(value: string, language?: string) => FakeModel>()
        .mockImplementationOnce(() => l)
        .mockImplementationOnce(() => r),
      EndOfLineSequence: { LF: 0, CRLF: 1 },
    },
  };
  return {
    monaco,
    editor,
    l,
    r,
    updateOptions,
    revealed,
    positions,
    decorations,
    setCaret: (p) => {
      caret = p;
    },
    select: (which, startLine, endLine = startLine) =>
      act(() =>
        cursorCbs[which]?.({
          selection: {
            startLineNumber: startLine,
            startColumn: 1,
            endLineNumber: endLine,
            endColumn: 1,
          },
        }),
      ),
    fireDiffUpdate: (next) => {
      changes = next;
      act(() => diffCb?.());
    },
  };
}

const change = (o: [number, number], m: [number, number]): MonacoLineChange => ({
  originalStartLineNumber: o[0],
  originalEndLineNumber: o[1],
  modifiedStartLineNumber: m[0],
  modifiedEndLineNumber: m[1],
});

const opts = (over: Partial<TextCompareOptions> = {}): TextCompareOptions => ({
  ...DEFAULT_TEXT_COMPARE_OPTIONS,
  ignorePatterns: [],
  ...over,
});

const LEFT = ['a', 'b', 'c', 'd', 'e'].join('\n');
const RIGHT = ['a', 'B', 'c', 'x', 'e'].join('\n');
const TWO_HUNKS = [change([2, 2], [2, 2]), change([4, 4], [4, 4])];

async function mount(h: Harness, props: Partial<React.ComponentProps<typeof TextDiffView>> = {}) {
  const utils = render(
    <TextDiffView
      relPath="src/foo.ts"
      leftText={LEFT}
      rightText={RIGHT}
      editableLeft
      editableRight
      monacoLoader={async () => h.monaco}
      {...props}
    />,
  );
  await waitFor(() => expect(h.updateOptions).toHaveBeenCalled());
  return utils;
}

describe('<TextDiffView /> difference navigation', () => {
  it('shows a counter and steps through differences with the toolbar', async () => {
    const h = makeHarness(LEFT, RIGHT);
    await mount(h);
    expect(screen.getByRole('status')).toHaveTextContent('No differences');

    h.fireDiffUpdate(TWO_HUNKS);
    expect(screen.getByRole('status')).toHaveTextContent('Difference – of 2');

    fireEvent.click(screen.getByRole('button', { name: 'Next difference' }));
    expect(h.revealed).toEqual([2]);
    expect(screen.getByRole('status')).toHaveTextContent('Difference 1 of 2');

    fireEvent.click(screen.getByRole('button', { name: 'Next difference' }));
    expect(h.revealed).toEqual([2, 4]);
    expect(screen.getByRole('status')).toHaveTextContent('Difference 2 of 2');

    // wraps around
    fireEvent.click(screen.getByRole('button', { name: 'Next difference' }));
    expect(h.revealed.at(-1)).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'Previous difference' }));
    expect(h.revealed.at(-1)).toBe(4);
  });

  it('F7 / Shift+F7 navigate from anywhere inside the view', async () => {
    const h = makeHarness(LEFT, RIGHT);
    await mount(h);
    h.fireDiffUpdate(TWO_HUNKS);
    const region = screen.getByRole('region', { name: /text diff for/i });
    fireEvent.keyDown(region, { key: 'F7' });
    expect(h.revealed).toEqual([2]);
    fireEvent.keyDown(region, { key: 'F7', shiftKey: true });
    expect(h.revealed.at(-1)).toBe(4);
    // other keys and modified F7 are ignored
    fireEvent.keyDown(region, { key: 'F8' });
    fireEvent.keyDown(region, { key: 'F7', ctrlKey: true });
    expect(h.revealed).toHaveLength(2);
  });

  it('continues from the caret when the user clicked elsewhere', async () => {
    const h = makeHarness(LEFT, RIGHT);
    await mount(h);
    h.fireDiffUpdate(TWO_HUNKS);
    h.setCaret({ lineNumber: 4, column: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Next difference' }));
    // caret is on hunk 2 → next wraps to hunk 1
    expect(h.revealed).toEqual([2]);
  });

  it('disables navigation when there are no differences', async () => {
    const h = makeHarness(LEFT, LEFT);
    await mount(h);
    h.fireDiffUpdate([]);
    expect(screen.getByRole('button', { name: 'Next difference' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous difference' })).toBeDisabled();
  });

  it('clamps the current difference when the hunk list shrinks', async () => {
    const h = makeHarness(LEFT, RIGHT);
    await mount(h);
    h.fireDiffUpdate(TWO_HUNKS);
    fireEvent.click(screen.getByRole('button', { name: 'Next difference' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next difference' }));
    h.fireDiffUpdate([TWO_HUNKS[0]!]);
    expect(screen.getByRole('status')).toHaveTextContent('Difference – of 1');
  });
});

describe('<TextDiffView /> ignored differences', () => {
  it('dims ignored hunks, excludes them from the count and skips them when stepping', async () => {
    const h = makeHarness(LEFT, RIGHT);
    await mount(h, { compareOptions: opts({ ignoreCase: true }) });
    h.fireDiffUpdate(TWO_HUNKS); // hunk 1 is b→B (case only), hunk 2 is d→x
    expect(screen.getByRole('status')).toHaveTextContent('Difference – of 1 · 1 ignored');
    expect(h.decorations.original).toEqual([
      expect.objectContaining({
        range: expect.objectContaining({ startLineNumber: 2, endLineNumber: 2 }),
        options: expect.objectContaining({ className: 'awapi-diff-ignored-line' }),
      }),
    ]);
    expect(h.decorations.modified).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Next difference' }));
    expect(h.revealed).toEqual([4]);
  });

  it('reports "No important differences" when everything is ignorable', async () => {
    const h = makeHarness('a\nb', 'a\nB');
    await mount(h, { compareOptions: opts({ ignoreCase: true }) });
    h.fireDiffUpdate([change([2, 2], [2, 2])]);
    expect(screen.getByRole('status')).toHaveTextContent('No important differences · 1 ignored');
  });

  it('re-classifies when the ignore options change', async () => {
    const h = makeHarness(LEFT, RIGHT);
    const { rerender } = await mount(h);
    h.fireDiffUpdate(TWO_HUNKS);
    expect(screen.getByRole('status')).toHaveTextContent('Difference – of 2');
    rerender(
      <TextDiffView
        relPath="src/foo.ts"
        leftText={LEFT}
        rightText={RIGHT}
        editableLeft
        editableRight
        monacoLoader={async () => h.monaco}
        compareOptions={opts({ ignoreCase: true })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Difference – of 1 · 1 ignored'),
    );
  });
});

describe('<TextDiffView /> copy current difference', () => {
  it('copies the selected hunk left → right and right → left', async () => {
    const h = makeHarness(LEFT, RIGHT);
    await mount(h);
    h.fireDiffUpdate(TWO_HUNKS);
    fireEvent.click(screen.getByRole('button', { name: 'Next difference' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy difference to right' }));
    expect(h.r.edits).toHaveLength(1);
    expect(h.r.edits[0]?.text).toBe('b\n');
    expect(h.r.edits[0]?.range).toMatchObject({ startLineNumber: 2, endLineNumber: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'Copy difference to left' }));
    expect(h.l.edits[0]?.text).toBe('B\n');
  });

  it('enables copy from a caret placed inside a difference, without navigating first', async () => {
    const h = makeHarness(LEFT, RIGHT);
    await mount(h);
    h.fireDiffUpdate(TWO_HUNKS);
    const toRight = screen.getByRole('button', { name: 'Copy difference to right' });
    const toLeft = screen.getByRole('button', { name: 'Copy difference to left' });
    expect(toRight).toBeDisabled();

    h.select('original', 1); // matching line: still nothing to copy
    expect(toRight).toBeDisabled();

    h.select('original', 4); // line 4 is inside hunk 2
    expect(toRight).toBeEnabled();
    expect(toLeft).toBeEnabled();
    fireEvent.click(toRight);
    expect(h.r.edits).toHaveLength(1);
    expect(h.r.edits[0]).toMatchObject({ text: 'd\n', range: { startLineNumber: 4 } });
  });

  it('copies a selection made on the opposite side as whole hunks', async () => {
    const h = makeHarness(LEFT, RIGHT);
    await mount(h);
    h.fireDiffUpdate(TWO_HUNKS);
    // Caret in the right editor, hunk 1; copy ← uses the right text as the source.
    h.select('modified', 2);
    fireEvent.click(screen.getByRole('button', { name: 'Copy difference to left' }));
    expect(h.l.edits).toHaveLength(1);
    expect(h.l.edits[0]?.text).toBe('B\n');
  });

  it('copies every hunk covered by a multi-line selection', async () => {
    const h = makeHarness(LEFT, RIGHT);
    await mount(h);
    h.fireDiffUpdate(TWO_HUNKS);
    h.select('modified', 1, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Copy difference to left' }));
    expect(h.l.edits.map((e) => e.text)).toEqual(['B\n', 'x\n']);
  });

  it('is disabled until a difference is selected', async () => {
    const h = makeHarness(LEFT, RIGHT);
    await mount(h);
    h.fireDiffUpdate(TWO_HUNKS);
    expect(screen.getByRole('button', { name: 'Copy difference to right' })).toBeDisabled();
  });

  it('asks to create the missing side when the target is not writable', async () => {
    const h = makeHarness(LEFT, '');
    const onCreateMissingSide = vi.fn();
    await mount(h, { rightText: '', editableRight: false, onCreateMissingSide });
    h.fireDiffUpdate([change([1, 5], [0, 0])]);
    fireEvent.click(screen.getByRole('button', { name: 'Next difference' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy difference to right' }));
    expect(onCreateMissingSide).toHaveBeenCalledWith('toRight');
    expect(h.r.edits).toHaveLength(0);
  });

  it('disables copy to a non-writable side with no create fallback', async () => {
    const h = makeHarness(LEFT, RIGHT);
    await mount(h, { editableRight: false });
    h.fireDiffUpdate(TWO_HUNKS);
    fireEvent.click(screen.getByRole('button', { name: 'Next difference' }));
    expect(screen.getByRole('button', { name: 'Copy difference to right' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy difference to left' })).toBeEnabled();
  });
});

describe('<TextDiffView /> view options', () => {
  it('pushes view options to Monaco and reports toggles to the host', async () => {
    const h = makeHarness(LEFT, RIGHT);
    const onCompareOptionsChange = vi.fn();
    await mount(h, {
      compareOptions: opts({ sideBySide: false, wordWrap: true, ignoreTrimWhitespace: false }),
      onCompareOptionsChange,
    });
    expect(h.updateOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        renderSideBySide: false,
        wordWrap: 'on',
        ignoreTrimWhitespace: false,
        renderMarginRevertIcon: true,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Inline' }));
    expect(onCompareOptionsChange).toHaveBeenCalledWith({ sideBySide: true });
    fireEvent.click(screen.getByRole('button', { name: 'Wrap' }));
    expect(onCompareOptionsChange).toHaveBeenCalledWith({ wordWrap: false });
  });

  it('edits ignore options through the popover and validates patterns', async () => {
    const h = makeHarness(LEFT, RIGHT);
    const onCompareOptionsChange = vi.fn();
    const onResetCompareOptions = vi.fn();
    await mount(h, {
      compareOptions: opts({ ignorePatterns: ['('] }),
      onCompareOptionsChange,
      onResetCompareOptions,
    });
    fireEvent.click(screen.getByRole('button', { name: /^Ignore/ }));
    fireEvent.click(screen.getByLabelText('Letter case'));
    expect(onCompareOptionsChange).toHaveBeenCalledWith({ ignoreCase: true });
    fireEvent.click(screen.getByLabelText('All whitespace'));
    expect(onCompareOptionsChange).toHaveBeenCalledWith({ ignoreAllWhitespace: true });
    fireEvent.click(screen.getByLabelText('Leading / trailing whitespace'));
    expect(onCompareOptionsChange).toHaveBeenCalledWith({ ignoreTrimWhitespace: false });

    expect(screen.getByRole('alert')).toHaveTextContent('(');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '\\d+\n\n//.*' } });
    expect(onCompareOptionsChange).toHaveBeenCalledWith({ ignorePatterns: ['\\d+', '//.*'] });

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onResetCompareOptions).toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Ignore options' })).not.toBeInTheDocument();
  });

  it('closes the ignore popover when clicking outside', async () => {
    const h = makeHarness(LEFT, RIGHT);
    await mount(h);
    fireEvent.click(screen.getByRole('button', { name: /^Ignore/ }));
    expect(screen.getByRole('dialog', { name: 'Ignore options' })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Ignore options' })).not.toBeInTheDocument();
  });
});

describe('<TextDiffView /> encoding and line endings', () => {
  it('renders per-side encoding pickers and reports changes', async () => {
    const h = makeHarness(LEFT, RIGHT);
    const onEncodingChange = vi.fn();
    await mount(h, { leftEncoding: 'utf-16le', rightEncoding: 'windows-1252', onEncodingChange });
    expect(screen.getByLabelText('Left encoding')).toHaveValue('utf-16le');
    expect(screen.getByLabelText('Right encoding')).toHaveValue('windows-1252');
    fireEvent.change(screen.getByLabelText('Right encoding'), { target: { value: 'utf-8-bom' } });
    expect(onEncodingChange).toHaveBeenCalledWith('right', 'utf-8-bom');
  });

  it('shows the model line endings and switches them via Monaco', async () => {
    const h = makeHarness(LEFT, RIGHT);
    h.l.eol = '\r\n';
    await mount(h);
    await waitFor(() => expect(screen.getByLabelText('Left line endings')).toHaveValue('crlf'));
    expect(screen.getByLabelText('Right line endings')).toHaveValue('lf');

    fireEvent.change(screen.getByLabelText('Right line endings'), { target: { value: 'crlf' } });
    expect(h.r.setEOL).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.getByLabelText('Right line endings')).toHaveValue('crlf'));
    fireEvent.change(screen.getByLabelText('Right line endings'), { target: { value: 'lf' } });
    expect(h.r.setEOL).toHaveBeenLastCalledWith(0);
  });

  it('flags mixed line endings and disables pickers for read-only sides', async () => {
    const h = makeHarness('a\r\nb\n', RIGHT);
    await mount(h, { leftText: 'a\r\nb\n', editableLeft: false });
    expect(screen.getByText('mixed line endings')).toBeInTheDocument();
    expect(screen.getByLabelText('Left encoding')).toBeDisabled();
    expect(screen.getByLabelText('Right encoding')).toBeEnabled();
  });
});

describe('computeHunkCopyEdit', () => {
  it('replaces the target block for a paired hunk', () => {
    const src = makeModel(LEFT);
    const tgt = makeModel(RIGHT);
    expect(computeHunkCopyEdit(change([4, 4], [4, 4]), src, tgt, 'toModified')).toEqual({
      range: { startLineNumber: 4, startColumn: 1, endLineNumber: 5, endColumn: 1 },
      text: 'd\n',
    });
  });

  it('inserts at the alignment point for a pure insertion', () => {
    const src = makeModel('a\nb\nc');
    const tgt = makeModel('a\nc');
    // `b` exists only on the source (original) side: target has zero lines after line 1.
    expect(computeHunkCopyEdit(change([2, 2], [1, 0]), src, tgt, 'toModified')).toEqual({
      range: { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 2 },
      text: '\nb',
    });
  });

  it('deletes the target-only lines when the source side has none', () => {
    const src = makeModel('a\nc');
    const tgt = makeModel('a\nb\nc');
    expect(computeHunkCopyEdit(change([1, 0], [2, 2]), src, tgt, 'toModified')).toMatchObject({
      text: '',
    });
  });

  it('works in the modified → original direction and at the top of the file', () => {
    const src = makeModel('x\na');
    const tgt = makeModel('a');
    expect(computeHunkCopyEdit(change([0, 0], [1, 1]), tgt, src, 'toOriginal')).toBeDefined();
    expect(computeHunkCopyEdit(change([0, 0], [1, 1]), src, tgt, 'toOriginal')).toEqual({
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
      text: 'x\n',
    });
  });
});
