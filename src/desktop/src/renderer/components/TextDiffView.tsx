import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, MutableRefObject } from 'react';
import {
  TEXT_ENCODINGS,
  detectEol,
  languageFromPath,
  type TextEncodingId,
} from '@awapi/shared';
import { filterTextLines, type ViewFilter } from '../viewFilter.js';
import {
  DEFAULT_TEXT_COMPARE_OPTIONS,
  classifyHunks,
  compileIgnorePatterns,
  ignoredSpans,
  hunkRevealLine,
  importantPosition,
  resolveBaseIndex,
  stepHunk,
  summarizeHunks,
  type ClassifiedHunk,
  type HunkLineReader,
  type LineSpan,
  type TextCompareOptions,
} from '../textCompare.js';
import { TextCompareToolbar } from './TextCompareToolbar.js';

/**
 * Imperative handle exposed via {@link TextDiffViewProps.actionsRef}.
 * Lets a parent component (e.g. the file-diff toolbar) trigger a save
 * for either side without owning the Monaco models directly.
 */
export interface TextDiffActions {
  /** Read the current original-side value and invoke `onSave('left', ...)`. */
  saveLeft(): Promise<void>;
  /** Read the current modified-side value and invoke `onSave('right', ...)`. */
  saveRight(): Promise<void>;
  /** Reset both models to the last prop-supplied text and clear dirty flags (discard edits). */
  discardEdits(): void;
}

/**
 * Minimal monaco surface we depend on. Defining it explicitly (rather
 * than importing `monaco-editor` here) lets tests inject a fake without
 * pulling Monaco's web-worker bundle into jsdom.
 */
export interface MonacoLike {
  /** `monaco.KeyMod` bitmask values we use. */
  KeyMod: { Alt: number; CtrlCmd: number; Shift: number };
  /** Subset of `monaco.KeyCode` values needed for our keybindings. */
  KeyCode: { RightArrow: number; LeftArrow: number; KeyS: number };
  editor: {
    createDiffEditor(
      container: HTMLElement,
      options?: Record<string, unknown>,
    ): MonacoDiffEditor;
    createModel(value: string, language?: string): MonacoModel;
    /** `monaco.editor.EndOfLineSequence`; optional so tiny fakes can omit it. */
    EndOfLineSequence?: { LF: number; CRLF: number };
  };
}

/** A line+column range within a Monaco model. */
export interface MonacoRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** A single text-replacement operation for `pushEditOperations`. */
export interface MonacoSingleEditOperation {
  range: MonacoRange;
  /** Replacement text; `null` deletes the range. */
  text: string | null;
}

/** A whole-line decoration (used to dim ignored differences). */
export interface MonacoDecoration {
  range: MonacoRange;
  options: { isWholeLine?: boolean; className?: string; zIndex?: number };
}

export interface MonacoDecorationsCollection {
  set(decorations: MonacoDecoration[]): void;
  clear(): void;
}

/** Minimal surface of an individual Monaco editor (original or modified side). */
export interface MonacoEditorInstance {
  addAction(descriptor: {
    id: string;
    label: string;
    keybindings?: number[];
    contextMenuGroupId?: string;
    contextMenuOrder?: number;
    run(editor: MonacoEditorInstance): void;
  }): { dispose(): void };
  getSelection(): MonacoRange | null;
  // The members below are optional so tiny test fakes don't have to
  // implement them; the view degrades gracefully without them.
  getPosition?(): { lineNumber: number; column: number } | null;
  onDidChangeCursorSelection?(cb: (e: { selection: MonacoRange }) => void): { dispose(): void };
  setPosition?(position: { lineNumber: number; column: number }): void;
  revealLineInCenter?(line: number): void;
  createDecorationsCollection?(decorations?: MonacoDecoration[]): MonacoDecorationsCollection;
}

/**
 * One entry in the result of `IDiffEditor.getLineChanges()`.
 *
 * When a side has no lines in a particular change (pure insertion or
 * deletion in the other side), Monaco sets that side's
 * `*EndLineNumber` to `0` and uses `*StartLineNumber` as the line
 * **after** which the lines are conceptually inserted (`0` meaning
 * "before line 1").
 */
export interface MonacoLineChange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

export interface MonacoDiffEditor {
  setModel(model: { original: MonacoModel; modified: MonacoModel }): void;
  layout(): void;
  dispose(): void;
  getOriginalEditor(): MonacoEditorInstance;
  getModifiedEditor(): MonacoEditorInstance;
  /** Line-level diff result; absent in fakes / before first compute. */
  getLineChanges?(): MonacoLineChange[] | null;
  /** Fires after Monaco (re)computes the diff. Optional for fakes. */
  onDidUpdateDiff?(cb: () => void): { dispose(): void };
  /**
   * Update editor options after construction. Used to flip the
   * `readOnly` / `originalEditable` flags when a side finishes
   * loading (or the active view filter changes) so the editor's
   * editability tracks the latest props. Optional so tiny test
   * fakes don't have to implement it.
   */
  updateOptions?(options: Record<string, unknown>): void;
}

export interface MonacoModel {
  getValue(): string;
  setValue(value: string): void;
  onDidChangeContent(cb: () => void): { dispose(): void };
  dispose(): void;
  getValueInRange(range: MonacoRange): string;
  pushEditOperations(
    beforeCursorState: unknown,
    editOperations: MonacoSingleEditOperation[],
    cursorStateComputer: unknown,
  ): unknown;
  /** Total line count; optional so tiny test fakes don't have to implement it. */
  getLineCount?(): number;
  /** 1-based max column for `line`; optional for the same reason. */
  getLineMaxColumn?(line: number): number;
  /** Current line-ending sequence (`'\n'` or `'\r\n'`); optional for the same reason. */
  getEOL?(): string;
  /** Switch the line-ending sequence; optional for the same reason. */
  setEOL?(eol: number): void;
}

export type MonacoLoader = () => Promise<MonacoLike>;

/**
 * Lazy default loader. Imports the real `monaco-editor` ESM build on
 * first use so Vite can bundle it, and registers the per-language
 * workers via `MonacoEnvironment.getWorker` (workers are emitted as
 * separate chunks by Vite's `?worker` import). Vitest aliases the
 * bare specifier to a tiny stub (see `vitest.config.ts`); the few
 * tests that mount this view inject a `monacoLoader` prop instead.
 */
export const defaultLoader: MonacoLoader = async () => {
  await ensureMonacoWorkers();
  const mod = await import('monaco-editor');
  return mod as unknown as MonacoLike;
};

let monacoWorkersReady: Promise<void> | null = null;

async function ensureMonacoWorkers(): Promise<void> {
  if (monacoWorkersReady) return monacoWorkersReady;
  monacoWorkersReady = (async () => {
    const [
      { default: EditorWorker },
      { default: JsonWorker },
      { default: CssWorker },
      { default: HtmlWorker },
      { default: TsWorker },
    ] = await Promise.all([
      import('monaco-editor/esm/vs/editor/editor.worker?worker'),
      import('monaco-editor/esm/vs/language/json/json.worker?worker'),
      import('monaco-editor/esm/vs/language/css/css.worker?worker'),
      import('monaco-editor/esm/vs/language/html/html.worker?worker'),
      import('monaco-editor/esm/vs/language/typescript/ts.worker?worker'),
    ]);
    (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
      getWorker(_workerId: string, label: string): Worker {
        if (label === 'json') return new JsonWorker();
        if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
        if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
        if (label === 'typescript' || label === 'javascript') return new TsWorker();
        return new EditorWorker();
      },
    };
  })();
  return monacoWorkersReady;
}

/**
 * Map a copy-side selection onto the correct destination edit using
 * Monaco's line-level diff result.
 *
 * The naive approach — `pushEditOperations` with the source `range`
 * unchanged — looks wrong whenever the diff editor inserts virtual
 * blank space to align matching content. Copying right line N "to
 * left" then overwrites left line N (often blank padding) instead of
 * inserting at the alignment point between the surrounding matched
 * lines. We instead locate the diff change covering the selection on
 * the source side and translate that change's coordinates to the
 * destination side: a paired modify becomes a full-line replace, and
 * a pure insertion becomes an insert at end-of-line `*StartLineNumber`
 * (or at the very top when that field is `0`).
 *
 * Returns `null` (caller should skip the edit) when the diff result is
 * unavailable or when the selection sits entirely on matching content
 * — in that case there is nothing meaningful to copy across.
 */
export function computeCopyEdit(
  editor: MonacoDiffEditor,
  source: MonacoModel,
  target: MonacoModel,
  selection: MonacoRange,
  direction: 'toModified' | 'toOriginal',
): MonacoSingleEditOperation | null {
  const changes = editor.getLineChanges?.() ?? null;
  if (changes == null) {
    // No diff info available (e.g. test fakes): preserve the legacy
    // "replace selection literally" behavior so existing callers/tests
    // keep working.
    return { range: selection, text: source.getValueInRange(selection) };
  }

  // The selection sits on the *source* side; pick the diff change(s)
  // it intersects there.
  const sourceSide = direction === 'toModified' ? 'original' : 'modified';
  const change = findChangeForSelection(changes, sourceSide, selection);
  if (!change) return null;

  return computeChangeEdit(change, source, target, selection, sourceSide);
}

/**
 * Edit that copies one whole diff hunk from `source` onto `target`.
 * Used by the toolbar's "Copy difference" buttons, which act on the
 * currently selected hunk rather than on an editor selection.
 */
export function computeHunkCopyEdit(
  change: MonacoLineChange,
  source: MonacoModel,
  target: MonacoModel,
  direction: 'toModified' | 'toOriginal',
): MonacoSingleEditOperation | null {
  const sourceSide = direction === 'toModified' ? 'original' : 'modified';
  const start = sourceSide === 'original' ? change.originalStartLineNumber : change.modifiedStartLineNumber;
  const line = Math.max(1, start);
  // A caret (not a range) makes `computeChangeEdit` take the whole hunk.
  const caret: MonacoRange = {
    startLineNumber: line,
    startColumn: 1,
    endLineNumber: line,
    endColumn: 1,
  };
  return computeChangeEdit(change, source, target, caret, sourceSide);
}

/**
 * Like {@link computeCopyEdit} but returns an edit for **every** diff
 * hunk that overlaps the selection.  This is the path taken by the
 * context-menu actions so that a wide selection (e.g. Cmd+A) copies
 * all visible changes in one shot rather than just the first one.
 */
export function computeCopyEdits(
  editor: MonacoDiffEditor,
  source: MonacoModel,
  target: MonacoModel,
  selection: MonacoRange,
  direction: 'toModified' | 'toOriginal',
): MonacoSingleEditOperation[] {
  const changes = editor.getLineChanges?.() ?? null;
  if (changes == null) {
    return [{ range: selection, text: source.getValueInRange(selection) }];
  }

  const sourceSide = direction === 'toModified' ? 'original' : 'modified';
  const ops: MonacoSingleEditOperation[] = [];
  for (const change of changes) {
    if (!changeIntersectsSelection(change, sourceSide, selection)) continue;
    const op = computeChangeEdit(change, source, target, selection, sourceSide);
    if (op) ops.push(op);
  }
  return ops;
}

/** Hunks whose lines on `side` overlap `selection` (a caret counts as a one-line selection). */
function hunksIntersecting(
  hunks: readonly ClassifiedHunk[],
  side: 'original' | 'modified',
  selection: MonacoRange,
): ClassifiedHunk[] {
  return hunks.filter((h) => changeIntersectsSelection(h.change, side, selection));
}

function changeIntersectsSelection(
  c: MonacoLineChange,
  side: 'original' | 'modified',
  sel: MonacoRange,
): boolean {
  const start = side === 'original' ? c.originalStartLineNumber : c.modifiedStartLineNumber;
  const end = side === 'original' ? c.originalEndLineNumber : c.modifiedEndLineNumber;
  if (end === 0) {
    // Source side has no lines; the anchor is the line after which the
    // target-only content sits (0 means before line 1 → anchor = 1).
    const anchor = start === 0 ? 1 : start;
    return sel.startLineNumber <= anchor && sel.endLineNumber >= anchor;
  }
  return sel.startLineNumber <= end && sel.endLineNumber >= start;
}

function computeChangeEdit(
  change: MonacoLineChange,
  source: MonacoModel,
  target: MonacoModel,
  selection: MonacoRange,
  sourceSide: 'original' | 'modified',
): MonacoSingleEditOperation | null {
  const srcStart = sourceSide === 'original' ? change.originalStartLineNumber : change.modifiedStartLineNumber;
  const srcEnd = sourceSide === 'original' ? change.originalEndLineNumber : change.modifiedEndLineNumber;
  const tgtStart = sourceSide === 'original' ? change.modifiedStartLineNumber : change.originalStartLineNumber;
  const tgtEnd = sourceSide === 'original' ? change.modifiedEndLineNumber : change.originalEndLineNumber;

  // Clip the source range to whatever the user actually selected. When
  // the user has only a caret (no real text range) we keep the legacy
  // "accept the whole hunk" behavior; when they highlighted a strict
  // subset of the hunk we copy only those lines so neighbouring lines
  // in the same Monaco-merged change aren't dragged along.
  const isCaret =
    selection.startLineNumber === selection.endLineNumber &&
    selection.startColumn === selection.endColumn;
  let selStartLine = selection.startLineNumber;
  let selEndLine = selection.endLineNumber;
  // A selection ending at column 1 of a following line excludes that
  // line (Monaco convention for full-line selections via triple-click
  // or Shift+Down).
  if (selection.endColumn === 1 && selEndLine > selStartLine) selEndLine -= 1;

  let copyStart = srcStart;
  let copyEnd = srcEnd;
  let isPartial = false;
  if (!isCaret && srcEnd > 0) {
    const clippedStart = Math.max(srcStart, selStartLine);
    const clippedEnd = Math.min(srcEnd, selEndLine);
    if (clippedEnd >= clippedStart && (clippedStart > srcStart || clippedEnd < srcEnd)) {
      copyStart = clippedStart;
      copyEnd = clippedEnd;
      isPartial = true;
    }
  }

  // Plain (no trailing newline) joined source lines. When the source
  // side has zero lines for this change, the operation effectively
  // becomes "delete the inserted lines on the target side".
  const sourceText = copyEnd === 0 ? '' : readLines(source, copyStart, copyEnd);

  if (tgtEnd === 0) {
    // Pure insertion on the target side. `tgtStart` is the line *after
    // which* content should be inserted (0 = before line 1).
    if (tgtStart === 0) {
      return {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
        text: sourceText.length > 0 ? sourceText + '\n' : '',
      };
    }
    const col = target.getLineMaxColumn ? target.getLineMaxColumn(tgtStart) : 1;
    return {
      range: { startLineNumber: tgtStart, startColumn: col, endLineNumber: tgtStart, endColumn: col },
      text: sourceText.length > 0 ? '\n' + sourceText : '',
    };
  }

  // Paired change. With a partial selection we need to map the
  // selected source-line offset onto the target side. Monaco aligns
  // the first `modifyCount` source lines line-for-line with the target
  // lines; any remaining source lines are pure insertions tacked on
  // after the modified block.
  if (isPartial) {
    const modifyCount = tgtEnd - tgtStart + 1;
    const selOffset = copyStart - srcStart;
    const selLines = copyEnd - copyStart + 1;

    if (selOffset >= modifyCount) {
      // Selection lies entirely in the inserted-tail portion of the
      // hunk → insert it after the last paired target line. Don't
      // overwrite anything.
      const col = target.getLineMaxColumn ? target.getLineMaxColumn(tgtEnd) : 1;
      return {
        range: { startLineNumber: tgtEnd, startColumn: col, endLineNumber: tgtEnd, endColumn: col },
        text: sourceText.length > 0 ? '\n' + sourceText : '',
      };
    }

    if (selOffset + selLines <= modifyCount) {
      // Selection is entirely within the line-aligned modify portion.
      const tStart = tgtStart + selOffset;
      const tEnd = tgtStart + selOffset + selLines - 1;
      const lineCount = target.getLineCount?.();
      const replacingLast = lineCount != null && tEnd >= lineCount;
      if (replacingLast) {
        const maxCol = target.getLineMaxColumn ? target.getLineMaxColumn(tEnd) : Number.MAX_SAFE_INTEGER;
        return {
          range: { startLineNumber: tStart, startColumn: 1, endLineNumber: tEnd, endColumn: maxCol },
          text: sourceText,
        };
      }
      return {
        range: { startLineNumber: tStart, startColumn: 1, endLineNumber: tEnd + 1, endColumn: 1 },
        text: sourceText.length > 0 ? sourceText + '\n' : '',
      };
    }

    // Spans the modify/insert boundary: replace target lines from the
    // selection's start offset through the end of the paired block
    // with the full selected source text.
    const tStart = tgtStart + selOffset;
    const lineCount = target.getLineCount?.();
    const replacingLast = lineCount != null && tgtEnd >= lineCount;
    if (replacingLast) {
      const maxCol = target.getLineMaxColumn ? target.getLineMaxColumn(tgtEnd) : Number.MAX_SAFE_INTEGER;
      return {
        range: { startLineNumber: tStart, startColumn: 1, endLineNumber: tgtEnd, endColumn: maxCol },
        text: sourceText,
      };
    }
    return {
      range: { startLineNumber: tStart, startColumn: 1, endLineNumber: tgtEnd + 1, endColumn: 1 },
      text: sourceText.length > 0 ? sourceText + '\n' : '',
    };
  }

  // Paired change, full hunk: replace the target lines wholesale.
  // Match the range and the replacement text on whether they include
  // a trailing newline so the final buffer keeps consistent line
  // endings.
  const lineCount = target.getLineCount?.();
  const replacingLastLine = lineCount != null && tgtEnd >= lineCount;
  if (replacingLastLine) {
    const maxCol = target.getLineMaxColumn ? target.getLineMaxColumn(tgtEnd) : Number.MAX_SAFE_INTEGER;
    return {
      range: { startLineNumber: tgtStart, startColumn: 1, endLineNumber: tgtEnd, endColumn: maxCol },
      text: sourceText,
    };
  }
  return {
    range: { startLineNumber: tgtStart, startColumn: 1, endLineNumber: tgtEnd + 1, endColumn: 1 },
    text: sourceText.length > 0 ? sourceText + '\n' : '',
  };
}

function findChangeForSelection(
  changes: MonacoLineChange[],
  side: 'original' | 'modified',
  sel: MonacoRange,
): MonacoLineChange | null {
  for (const c of changes) {
    const start = side === 'original' ? c.originalStartLineNumber : c.modifiedStartLineNumber;
    const end = side === 'original' ? c.originalEndLineNumber : c.modifiedEndLineNumber;
    if (end === 0) {
      // The source side has no lines for this change — the user can
      // only "select" it by clicking the alignment line (`start`) or
      // the line just after it.
      if (sel.startLineNumber === start || sel.startLineNumber === start + 1) return c;
      continue;
    }
    if (sel.startLineNumber <= end && sel.endLineNumber >= start) return c;
  }
  return null;
}

function readLines(model: MonacoModel, startLine: number, endLine: number): string {
  const maxCol = model.getLineMaxColumn ? model.getLineMaxColumn(endLine) : Number.MAX_SAFE_INTEGER;
  return model.getValueInRange({
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: endLine,
    endColumn: maxCol,
  });
}

export interface TextDiffViewProps {
  relPath: string;
  /** UTF-8 contents of the left side, or `null` when absent. */
  leftText: string | null;
  /** UTF-8 contents of the right side, or `null` when absent. */
  rightText: string | null;
  /** True iff the user can edit the modified (right) side. */
  editableRight?: boolean;
  /** True iff the user can edit the original (left) side. */
  editableLeft?: boolean;
  /**
   * Invoked when the user requests Save on the given side. The host
   * component is responsible for writing to disk (with optional
   * external-modification check) and refreshing the view.
   */
  onSave?: (side: 'left' | 'right', value: string) => Promise<void>;
  /**
   * Notifies the host whenever the dirty state on either side
   * changes. The host can use this to render a tab-level "unsaved
   * changes" marker.
   */
  onDirtyChange?: (state: { left: boolean; right: boolean }) => void;
  /**
   * Notifies the host whenever a save is in flight (or finishes).
   * `'left' | 'right'` while the corresponding side is being saved,
   * `null` when idle.
   */
  onSavingChange?: (saving: 'left' | 'right' | null) => void;
  /**
   * Imperative handle for triggering a save from outside the
   * component (e.g. the toolbar). The component populates
   * `actionsRef.current` once the editor is ready and clears it on
   * unmount.
   */
  actionsRef?: MutableRefObject<TextDiffActions | null>;
  /** Lazy Monaco loader; overridable for tests. */
  monacoLoader?: MonacoLoader;
  /**
   * Renderer-only line filter. `'diffs'` shows only differing lines on
   * each side, `'same'` shows only matching lines, `'all'` (default)
   * passes the buffers through. Edits are disabled when a non-`'all'`
   * filter is active to prevent saving the filtered subset back to
   * disk.
   */
  viewFilter?: ViewFilter;
  /**
   * Optional escape hatch for "Copy → Right" / "Copy ← Left" when the
   * destination side is not editable because it does not exist yet.
   * The host (file-diff tab) supplies this when the target side is
   * `'absent'` and the source side is `'ready'`; selecting the menu
   * item then surfaces a create-confirm prompt instead of silently
   * doing nothing. `'toRight'` means copy the original (left) onto a
   * non-existent right; `'toLeft'` is the inverse.
   */
  onCreateMissingSide?: (direction: 'toLeft' | 'toRight') => void;
  /**
   * Text-compare view options (ignore whitespace / case / regex, inline,
   * wrap). Defaults to {@link DEFAULT_TEXT_COMPARE_OPTIONS}; the file-diff
   * tab supplies the persisted global options.
   */
  compareOptions?: TextCompareOptions;
  onCompareOptionsChange?: (patch: Partial<TextCompareOptions>) => void;
  onResetCompareOptions?: () => void;
  /**
   * Encoding the file on each side will be saved with. The host owns
   * this (it is detected from the bytes on load and applied when
   * encoding for save); the view only renders the picker.
   */
  leftEncoding?: TextEncodingId;
  rightEncoding?: TextEncodingId;
  onEncodingChange?: (side: 'left' | 'right', encoding: TextEncodingId) => void;
}

/** Monaco diff-editor options derived from the text-compare options. */
function monacoViewOptions(
  o: Pick<TextCompareOptions, 'ignoreTrimWhitespace' | 'sideBySide' | 'wordWrap'>,
): Record<string, unknown> {
  return {
    ignoreTrimWhitespace: o.ignoreTrimWhitespace,
    renderSideBySide: o.sideBySide,
    wordWrap: o.wordWrap ? 'on' : 'off',
    // Gutter arrow that reverts a hunk to the left side's text.
    renderMarginRevertIcon: true,
  };
}

function toDecoration(span: LineSpan): MonacoDecoration {
  return {
    range: { startLineNumber: span.start, startColumn: 1, endLineNumber: span.end, endColumn: 1 },
    // High zIndex so the dimming sits above Monaco's own insert/delete tint.
    options: { isWholeLine: true, className: 'awapi-diff-ignored-line', zIndex: 100 },
  };
}

/** Line ending of a model; LF for fakes that lack `getEOL`. */
function readEol(model: MonacoModel | null | undefined): 'lf' | 'crlf' {
  return model?.getEOL?.() === '\r\n' ? 'crlf' : 'lf';
}

/**
 * Monaco-backed text diff view. Loading is lazy and idempotent — the
 * editor is created exactly once per mount, then the models are
 * swapped when `leftText` / `rightText` change.
 */
export function TextDiffView(props: TextDiffViewProps): JSX.Element {
  const {
    relPath,
    leftText,
    rightText,
    editableLeft,
    editableRight,
    onSave,
    onDirtyChange,
    onSavingChange,
    actionsRef,
    monacoLoader = defaultLoader,
    viewFilter = 'all',
    onCreateMissingSide,
    compareOptions = DEFAULT_TEXT_COMPARE_OPTIONS,
    onCompareOptionsChange,
    onResetCompareOptions,
    leftEncoding = 'utf-8',
    rightEncoding = 'utf-8',
    onEncodingChange,
  } = props;

  // Apply the All/Diffs/Same filter to the buffers fed to Monaco. The
  // helper bails out (and returns the original text untouched) when
  // either side exceeds its line cap.
  const filtered = filterTextLines(leftText, rightText, viewFilter);
  const displayLeftText = leftText === null ? null : filtered.leftText;
  const displayRightText = rightText === null ? null : filtered.rightText;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoDiffEditor | null>(null);
  const monacoRef = useRef<MonacoLike | null>(null);
  const modelsRef = useRef<{ original: MonacoModel; modified: MonacoModel } | null>(null);
  const subscriptionsRef = useRef<Array<{ dispose(): void }>>([]);
  // Track editability for context-menu actions registered once at mount.
  const editableRightRef = useRef(editableRight);
  editableRightRef.current = editableRight;
  const editableLeftRef = useRef(editableLeft);
  editableLeftRef.current = editableLeft;
  // Mirror the create-missing callback into a ref so the Monaco
  // actions registered once at mount always call the latest closure.
  const onCreateMissingSideRef = useRef(onCreateMissingSide);
  onCreateMissingSideRef.current = onCreateMissingSide;
  // Holds the latest `handleSave` so keybindings registered once at
  // mount can invoke the current callback (which closes over
  // `onSave`).
  const handleSaveRef = useRef<((side: 'left' | 'right') => Promise<void>) | null>(null);
  const [editorState, setEditorState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [leftDirty, setLeftDirty] = useState(false);
  const [rightDirty, setRightDirty] = useState(false);
  const [saving, setSaving] = useState<'left' | 'right' | null>(null);
  const [eol, setEol] = useState<{ left: 'lf' | 'crlf'; right: 'lf' | 'crlf' }>({
    left: 'lf',
    right: 'lf',
  });
  const [hunks, setHunks] = useState<ClassifiedHunk[]>([]);
  const [currentHunk, setCurrentHunk] = useState(-1);
  // Last caret / selection the user made, and in which editor. Drives
  // which differences the copy buttons act on.
  const [cursor, setCursor] = useState<{ side: 'original' | 'modified'; selection: MonacoRange } | null>(
    null,
  );
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  // Mirrors for callbacks registered once at mount.
  const optionsRef = useRef(compareOptions);
  optionsRef.current = compareOptions;
  const patternsKey = JSON.stringify(compareOptions.ignorePatterns);
  const compiledRef = useRef(compileIgnorePatterns(compareOptions.ignorePatterns));
  const compiledKeyRef = useRef(patternsKey);
  if (compiledKeyRef.current !== patternsKey) {
    compiledKeyRef.current = patternsKey;
    compiledRef.current = compileIgnorePatterns(compareOptions.ignorePatterns);
  }
  const hunksRef = useRef<ClassifiedHunk[]>([]);
  hunksRef.current = hunks;
  const currentHunkRef = useRef(-1);
  currentHunkRef.current = currentHunk;
  const decorationsRef = useRef<{
    original: { set(d: MonacoDecoration[]): void; clear(): void } | null;
    modified: { set(d: MonacoDecoration[]): void; clear(): void } | null;
  }>({ original: null, modified: null });

  // Re-classify Monaco's line hunks (ignored vs important). Cheap when
  // no soft-ignore option is active: the reader is never invoked.
  const recomputeHunks = useCallback(() => {
    const editor = editorRef.current;
    const models = modelsRef.current;
    if (!editor || !models) return;
    const read: HunkLineReader = (side, start, end) =>
      readLines(side === 'original' ? models.original : models.modified, start, end);
    const next = classifyHunks(
      editor.getLineChanges?.() ?? null,
      read,
      optionsRef.current,
      compiledRef.current.regexes,
    );
    setHunks(next);
    setCurrentHunk((cur) => (cur >= next.length ? -1 : cur));
  }, []);
  const recomputeHunksRef = useRef(recomputeHunks);
  recomputeHunksRef.current = recomputeHunks;

  const refreshEol = useCallback(() => {
    const m = modelsRef.current;
    if (!m) return;
    const next = { left: readEol(m.original), right: readEol(m.modified) };
    setEol((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);
  const refreshEolRef = useRef(refreshEol);
  refreshEolRef.current = refreshEol;

  // Mount: load Monaco and create the diff editor.
  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current) return;
    setEditorState('loading');
    void (async () => {
      try {
        const monaco = await monacoLoader();
        if (cancelled) return;
        monacoRef.current = monaco;
        const lang = languageFromPath(relPath);
        const original = monaco.editor.createModel(displayLeftText ?? '', lang);
        const modified = monaco.editor.createModel(displayRightText ?? '', lang);
        const container = containerRef.current;
        if (!container) {
          original.dispose();
          modified.dispose();
          return;
        }
        const editor = monaco.editor.createDiffEditor(container, {
          automaticLayout: true,
          readOnly: !editableRight,
          originalEditable: editableLeft === true,
          minimap: { enabled: false },
          ...monacoViewOptions(optionsRef.current),
        });
        editor.setModel({ original, modified });
        editorRef.current = editor;
        modelsRef.current = { original, modified };
        refreshEolRef.current();
        // Attach change listeners *after* the initial models are
        // installed so the synthetic createModel writes don't mark
        // the buffers dirty on first paint.
        const subL = original.onDidChangeContent(() => {
          setLeftDirty(original.getValue() !== (displayLeftTextRef.current ?? ''));
          refreshEolRef.current();
        });
        const subR = modified.onDidChangeContent(() => {
          setRightDirty(modified.getValue() !== (displayRightTextRef.current ?? ''));
          refreshEolRef.current();
        });
        subscriptionsRef.current.push(subL, subR);
        const subDiff = editor.onDidUpdateDiff?.(() => recomputeHunksRef.current());
        if (subDiff) subscriptionsRef.current.push(subDiff);
        for (const side of ['original', 'modified'] as const) {
          const ed = side === 'original' ? editor.getOriginalEditor() : editor.getModifiedEditor();
          const sub = ed.onDidChangeCursorSelection?.((e) => setCursor({ side, selection: e.selection }));
          if (sub) subscriptionsRef.current.push(sub);
        }
        decorationsRef.current = {
          original: editor.getOriginalEditor().createDecorationsCollection?.([]) ?? null,
          modified: editor.getModifiedEditor().createDecorationsCollection?.([]) ?? null,
        };

        // Context-menu actions: "Copy → Right" (from original) and
        // "Copy ← Left" (from modified), mirroring the folder-compare
        // context menu. Keybindings use Alt+Shift+Arrow (rather than
        // plain Alt+Arrow) so they don't collide with macOS
        // Option+Arrow word navigation.
        const subCopyRight = editor.getOriginalEditor().addAction({
          id: 'awapi.copySelectionToRight',
          label: 'Copy → Right',
          keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.RightArrow],
          contextMenuGroupId: 'awapi',
          contextMenuOrder: 1,
          run(ed) {
            if (!modelsRef.current || !editorRef.current) return;
            if (!editableRightRef.current) {
              // Right side is not editable. The most common reason is
              // that it does not exist yet (file-diff tab opened from
              // a left-only folder-compare row). Surface the create
              // prompt instead of silently no-oping.
              onCreateMissingSideRef.current?.('toRight');
              return;
            }
            const sel = ed.getSelection();
            if (!sel) return;
            const ops = computeCopyEdits(
              editorRef.current,
              modelsRef.current.original,
              modelsRef.current.modified,
              sel,
              'toModified',
            );
            if (ops.length === 0) return;
            modelsRef.current.modified.pushEditOperations([], ops, () => null);
          },
        });
        const subCopyLeft = editor.getModifiedEditor().addAction({
          id: 'awapi.copySelectionToLeft',
          label: 'Copy \u2190 Left',
          keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.LeftArrow],
          contextMenuGroupId: 'awapi',
          contextMenuOrder: 1,
          run(ed) {
            if (!modelsRef.current || !editorRef.current) return;
            if (!editableLeftRef.current) {
              // Left side is not editable — typically because it does
              // not exist yet. Surface the create prompt rather than
              // silently no-oping.
              onCreateMissingSideRef.current?.('toLeft');
              return;
            }
            const sel = ed.getSelection();
            if (!sel) return;
            const ops = computeCopyEdits(
              editorRef.current,
              modelsRef.current.modified,
              modelsRef.current.original,
              sel,
              'toOriginal',
            );
            if (ops.length === 0) return;
            modelsRef.current.original.pushEditOperations([], ops, () => null);
          },
        });
        subscriptionsRef.current.push(subCopyRight, subCopyLeft);

        // Cmd/Ctrl+S inside either editor saves the corresponding
        // side. Registered as Monaco actions so the keybinding is
        // captured before the browser's default Save dialog.
        const subSaveLeft = editor.getOriginalEditor().addAction({
          id: 'awapi.saveLeft',
          label: 'Save left',
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
          contextMenuGroupId: 'awapi',
          contextMenuOrder: 2,
          run() {
            if (!editableLeftRef.current) return;
            void handleSaveRef.current?.('left');
          },
        });
        const subSaveRight = editor.getModifiedEditor().addAction({
          id: 'awapi.saveRight',
          label: 'Save right',
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
          contextMenuGroupId: 'awapi',
          contextMenuOrder: 2,
          run() {
            if (!editableRightRef.current) return;
            void handleSaveRef.current?.('right');
          },
        });
        subscriptionsRef.current.push(subSaveLeft, subSaveRight);

        setEditorState('ready');
      } catch (err) {
        if (cancelled) return;
        setEditorState('error');
        setEditorError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      for (const sub of subscriptionsRef.current) sub.dispose();
      subscriptionsRef.current = [];
      decorationsRef.current.original?.clear();
      decorationsRef.current.modified?.clear();
      decorationsRef.current = { original: null, modified: null };
      editorRef.current?.dispose();
      modelsRef.current?.original.dispose();
      modelsRef.current?.modified.dispose();
      editorRef.current = null;
      modelsRef.current = null;
    };
  }, []);

  // Keep editability in sync with the latest props. The mount effect
  // above captures `editableLeft` / `editableRight` exactly once, so
  // without this follow-up the editor stays read-only forever if the
  // right-side file finishes loading *after* the editor was created
  // (common for ad-hoc file pairs where each side loads independently
  // and one finishes first). The Monaco diff editor reads the
  // `readOnly` flag from the modified-side editor and
  // `originalEditable` as a top-level flag.
  useEffect(() => {
    if (editorState !== 'ready') return;
    const editor = editorRef.current;
    if (!editor?.updateOptions) return;
    editor.updateOptions({
      readOnly: !editableRight,
      originalEditable: editableLeft === true,
    });
  }, [editorState, editableLeft, editableRight]);

  // Push view options (trim-whitespace, inline, wrap) into Monaco.
  const { ignoreTrimWhitespace, sideBySide, wordWrap } = compareOptions;
  useEffect(() => {
    if (editorState !== 'ready') return;
    editorRef.current?.updateOptions?.(
      monacoViewOptions({ ignoreTrimWhitespace, sideBySide, wordWrap }),
    );
  }, [editorState, ignoreTrimWhitespace, sideBySide, wordWrap]);

  // Soft-ignore options change which hunks count as important.
  const { ignoreAllWhitespace, ignoreCase } = compareOptions;
  useEffect(() => {
    if (editorState !== 'ready') return;
    recomputeHunks();
  }, [editorState, ignoreAllWhitespace, ignoreCase, patternsKey, recomputeHunks]);

  // Dim the lines of ignored hunks.
  useEffect(() => {
    const spansFor = (side: 'original' | 'modified'): MonacoDecoration[] =>
      ignoredSpans(hunks, side).map(toDecoration);
    decorationsRef.current.original?.set(spansFor('original'));
    decorationsRef.current.modified?.set(spansFor('modified'));
  }, [hunks]);

  // Re-sync model contents when the parent supplies new text (e.g.
  // after a save flushed the dirty state, or — crucially — once the
  // editor finishes loading and `modelsRef.current` becomes
  // available. We depend on `editorState` so the sync also runs on
  // the transition to `'ready'`, in case the data loaded before
  // Monaco did.
  //
  // CRITICAL: this effect runs whenever EITHER side's text prop
  // changes (e.g. after a single-side reload following a save).
  // Without per-side change tracking, the unchanged side's `setValue`
  // branch would still fire — silently discarding unsaved edits and
  // clearing the dirty flag. We therefore only overwrite a side when
  // its OWN prop value actually changed since the last sync.
  const lastSyncedLeftRef = useRef<string | null>(null);
  const lastSyncedRightRef = useRef<string | null>(null);
  const displayLeftTextRef = useRef(displayLeftText);
  displayLeftTextRef.current = displayLeftText;
  const displayRightTextRef = useRef(displayRightText);
  displayRightTextRef.current = displayRightText;
  useEffect(() => {
    if (editorState !== 'ready') return;
    const m = modelsRef.current;
    if (!m) return;
    if (displayLeftText !== null && displayLeftText !== lastSyncedLeftRef.current) {
      lastSyncedLeftRef.current = displayLeftText;
      if (m.original.getValue() !== displayLeftText) {
        m.original.setValue(displayLeftText);
        setLeftDirty(false);
      }
    }
    if (displayRightText !== null && displayRightText !== lastSyncedRightRef.current) {
      lastSyncedRightRef.current = displayRightText;
      if (m.modified.getValue() !== displayRightText) {
        m.modified.setValue(displayRightText);
        setRightDirty(false);
      }
    }
    refreshEolRef.current();
    // The container size is often 0 while React was still painting
    // the initial frame; force a re-layout once content arrives.
    editorRef.current?.layout();
  }, [displayLeftText, displayRightText, editorState]);

  const handleSave = useCallback(
    async (side: 'left' | 'right') => {
      if (!onSave || !modelsRef.current) return;
      const value =
        side === 'left'
          ? modelsRef.current.original.getValue()
          : modelsRef.current.modified.getValue();
      setSaving(side);
      try {
        await onSave(side, value);
        if (side === 'left') setLeftDirty(false);
        else setRightDirty(false);
      } finally {
        setSaving(null);
      }
    },
    [onSave],
  );
  // Keep the ref in sync so the mount-effect's Monaco actions always
  // call the latest `handleSave`.
  handleSaveRef.current = handleSave;

  const goToHunk = useCallback((index: number) => {
    const hunk = hunksRef.current[index];
    const editor = editorRef.current;
    if (!hunk || !editor) return;
    setCurrentHunk(index);
    const modified = editor.getModifiedEditor();
    const line = hunkRevealLine(hunk.change);
    modified.revealLineInCenter?.(line);
    modified.setPosition?.({ lineNumber: line, column: 1 });
  }, []);

  const stepDifference = useCallback(
    (direction: 'next' | 'previous') => {
      const editor = editorRef.current;
      if (!editor) return;
      const base = resolveBaseIndex(
        hunksRef.current,
        currentHunkRef.current,
        editor.getModifiedEditor().getPosition?.() ?? null,
      );
      const target = stepHunk(hunksRef.current, base, direction);
      if (target >= 0) goToHunk(target);
    },
    [goToHunk],
  );

  // Copy the difference(s) under the caret / selection; fall back to the
  // one last jumped to with the ▲/▼ buttons.
  const copyDifference = useCallback((direction: 'toModified' | 'toOriginal') => {
    const models = modelsRef.current;
    const editor = editorRef.current;
    if (!models || !editor) return;
    const sel = cursorRef.current;
    const hits = sel ? hunksIntersecting(hunksRef.current, sel.side, sel.selection) : [];
    const fallback = hunksRef.current[currentHunkRef.current];
    if (hits.length === 0 && !fallback) return;
    const writable = direction === 'toModified' ? editableRightRef.current : editableLeftRef.current;
    if (!writable) {
      // Target side does not exist yet: surface the create prompt.
      onCreateMissingSideRef.current?.(direction === 'toModified' ? 'toRight' : 'toLeft');
      return;
    }
    const [source, target] =
      direction === 'toModified' ? [models.original, models.modified] : [models.modified, models.original];
    const sourceSide = direction === 'toModified' ? 'original' : 'modified';
    let ops: MonacoSingleEditOperation[];
    if (sel && hits.length > 0 && sel.side === sourceSide) {
      // Selection is on the side being copied from: honour partial-hunk selections.
      ops = computeCopyEdits(editor, source, target, sel.selection, direction);
    } else {
      const changes = hits.length > 0 ? hits.map((h) => h.change) : fallback ? [fallback.change] : [];
      ops = changes.flatMap((c) => computeHunkCopyEdit(c, source, target, direction) ?? []);
    }
    if (ops.length > 0) target.pushEditOperations([], ops, () => null);
  }, []);

  const changeEol = useCallback((side: 'left' | 'right', next: 'lf' | 'crlf') => {
    const models = modelsRef.current;
    const seq = monacoRef.current?.editor.EndOfLineSequence;
    if (!models || !seq) return;
    const model = side === 'left' ? models.original : models.modified;
    model.setEOL?.(next === 'crlf' ? seq.CRLF : seq.LF);
    refreshEolRef.current();
  }, []);

  // Capture phase so F7 reaches us before Monaco's own (accessible
  // diff viewer) binding for the same key.
  const handleKeyDownCapture = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'F7' || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      stepDifference(e.shiftKey ? 'previous' : 'next');
    },
    [stepDifference],
  );

  const summary = summarizeHunks(hunks);
  const hasCurrent = currentHunk >= 0 && currentHunk < hunks.length;
  const canCopy =
    hasCurrent || (cursor !== null && hunksIntersecting(hunks, cursor.side, cursor.selection).length > 0);

  // Publish the imperative save handle so the toolbar can invoke
  // saves without owning the Monaco models directly. We re-register
  // whenever `handleSave` changes (i.e. when the `onSave` callback
  // identity changes) so the toolbar always calls the latest version.
  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      saveLeft: () => handleSave('left'),
      saveRight: () => handleSave('right'),
      discardEdits: () => {
        const m = modelsRef.current;
        if (!m) return;
        const lt = displayLeftTextRef.current;
        const rt = displayRightTextRef.current;
        if (lt !== null) {
          m.original.setValue(lt);
          lastSyncedLeftRef.current = lt;
          setLeftDirty(false);
        }
        if (rt !== null) {
          m.modified.setValue(rt);
          lastSyncedRightRef.current = rt;
          setRightDirty(false);
        }
      },
    };
    return () => {
      if (actionsRef.current && actionsRef.current.saveLeft === handleSave) {
        // No-op: cleanup happens on unmount via the next effect.
      }
      actionsRef.current = null;
    };
  }, [actionsRef, handleSave]);

  // Bubble dirty-state changes to the host (used to render the
  // tab-level unsaved-changes marker).
  useEffect(() => {
    onDirtyChange?.({ left: leftDirty, right: rightDirty });
  }, [leftDirty, rightDirty, onDirtyChange]);

  // Bubble in-flight save state to the host (used to drive the
  // toolbar Save buttons' disabled / "Saving…" label).
  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  return (
    <section
      className="awapi-textdiff"
      aria-label={`Text diff for ${relPath}`}
      onKeyDownCapture={handleKeyDownCapture}
    >
      <TextCompareToolbar
        relPath={relPath}
        options={compareOptions}
        onOptionsChange={(patch) => onCompareOptionsChange?.(patch)}
        onResetOptions={() => onResetCompareOptions?.()}
        summary={summary}
        position={importantPosition(hunks, currentHunk)}
        onNext={() => stepDifference('next')}
        onPrevious={() => stepDifference('previous')}
        onCopyToRight={() => copyDifference('toModified')}
        onCopyToLeft={() => copyDifference('toOriginal')}
        copyToRightDisabled={!canCopy || (!editableRight && !onCreateMissingSide)}
        copyToLeftDisabled={!canCopy || (!editableLeft && !onCreateMissingSide)}
      >
        {editorState === 'loading' ? <span>Loading editor…</span> : null}
        {editorState === 'error' ? (
          <span className="awapi-textdiff__error">Editor failed: {editorError}</span>
        ) : null}
      </TextCompareToolbar>
      <div ref={containerRef} className="awapi-textdiff__editor" />
      <div className="awapi-textdiff__formatbar" role="group" aria-label="File format">
        <FormatControls
          side="left"
          label="Left"
          encoding={leftEncoding}
          eol={eol.left}
          mixedEol={leftText !== null && detectEol(leftText) === 'mixed'}
          disabled={!editableLeft}
          onEncodingChange={(enc) => onEncodingChange?.('left', enc)}
          onEolChange={(next) => changeEol('left', next)}
        />
        <FormatControls
          side="right"
          label="Right"
          encoding={rightEncoding}
          eol={eol.right}
          mixedEol={rightText !== null && detectEol(rightText) === 'mixed'}
          disabled={!editableRight}
          onEncodingChange={(enc) => onEncodingChange?.('right', enc)}
          onEolChange={(next) => changeEol('right', next)}
        />
      </div>
    </section>
  );
}

function FormatControls({
  side,
  label,
  encoding,
  eol,
  mixedEol,
  disabled,
  onEncodingChange,
  onEolChange,
}: {
  side: 'left' | 'right';
  label: string;
  encoding: TextEncodingId;
  eol: 'lf' | 'crlf';
  mixedEol: boolean;
  disabled: boolean;
  onEncodingChange(encoding: TextEncodingId): void;
  onEolChange(eol: 'lf' | 'crlf'): void;
}): JSX.Element {
  return (
    <div className={`awapi-textdiff__format awapi-textdiff__format--${side}`}>
      <span className="awapi-textdiff__format-label">{label}</span>
      <select
        aria-label={`${label} encoding`}
        value={encoding}
        disabled={disabled}
        onChange={(e) => onEncodingChange(e.target.value as TextEncodingId)}
      >
        {TEXT_ENCODINGS.map((enc) => (
          <option key={enc.id} value={enc.id}>
            {enc.label}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} line endings`}
        value={eol}
        disabled={disabled}
        onChange={(e) => onEolChange(e.target.value as 'lf' | 'crlf')}
      >
        <option value="lf">LF (Unix)</option>
        <option value="crlf">CRLF (Windows)</option>
      </select>
      {mixedEol ? (
        <span className="awapi-textdiff__format-note" title="Mixed line endings are unified when saving">
          mixed line endings
        </span>
      ) : null}
    </div>
  );
}
