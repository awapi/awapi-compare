import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, MutableRefObject } from 'react';
import { languageFromPath } from '@awapi/shared';
import { filterTextLines, type ViewFilter } from '../viewFilter.js';

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
}

export interface MonacoDiffEditor {
  setModel(model: { original: MonacoModel; modified: MonacoModel }): void;
  layout(): void;
  dispose(): void;
  getOriginalEditor(): MonacoEditorInstance;
  getModifiedEditor(): MonacoEditorInstance;
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
const defaultLoader: MonacoLoader = async () => {
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
  // Holds the latest `handleSave` so keybindings registered once at
  // mount can invoke the current callback (which closes over
  // `onSave`).
  const handleSaveRef = useRef<((side: 'left' | 'right') => Promise<void>) | null>(null);
  const [editorState, setEditorState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [leftDirty, setLeftDirty] = useState(false);
  const [rightDirty, setRightDirty] = useState(false);
  const [saving, setSaving] = useState<'left' | 'right' | null>(null);

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
        });
        editor.setModel({ original, modified });
        editorRef.current = editor;
        modelsRef.current = { original, modified };
        // Attach change listeners *after* the initial models are
        // installed so the synthetic createModel writes don't mark
        // the buffers dirty on first paint.
        const subL = original.onDidChangeContent(() => setLeftDirty(true));
        const subR = modified.onDidChangeContent(() => setRightDirty(true));
        subscriptionsRef.current.push(subL, subR);

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
            if (!editableRightRef.current || !modelsRef.current) return;
            const sel = ed.getSelection();
            if (!sel) return;
            const text = modelsRef.current.original.getValueInRange(sel);
            modelsRef.current.modified.pushEditOperations([], [{ range: sel, text }], () => null);
          },
        });
        const subCopyLeft = editor.getModifiedEditor().addAction({
          id: 'awapi.copySelectionToLeft',
          label: 'Copy \u2190 Left',
          keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.LeftArrow],
          contextMenuGroupId: 'awapi',
          contextMenuOrder: 1,
          run(ed) {
            if (!editableLeftRef.current || !modelsRef.current) return;
            const sel = ed.getSelection();
            if (!sel) return;
            const text = modelsRef.current.modified.getValueInRange(sel);
            modelsRef.current.original.pushEditOperations([], [{ range: sel, text }], () => null);
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
      editorRef.current?.dispose();
      modelsRef.current?.original.dispose();
      modelsRef.current?.modified.dispose();
      editorRef.current = null;
      modelsRef.current = null;
    };
  }, []);

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

  // Publish the imperative save handle so the toolbar can invoke
  // saves without owning the Monaco models directly. We re-register
  // whenever `handleSave` changes (i.e. when the `onSave` callback
  // identity changes) so the toolbar always calls the latest version.
  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      saveLeft: () => handleSave('left'),
      saveRight: () => handleSave('right'),
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
    <section className="awapi-textdiff" aria-label={`Text diff for ${relPath}`}>
      <header className="awapi-textdiff__toolbar" role="toolbar">
        <span className="awapi-textdiff__title">{relPath}</span>
        {editorState === 'loading' ? <span>Loading editor…</span> : null}
        {editorState === 'error' ? (
          <span className="awapi-textdiff__error">Editor failed: {editorError}</span>
        ) : null}
      </header>
      <div ref={containerRef} className="awapi-textdiff__editor" />
    </section>
  );
}
