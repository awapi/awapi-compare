import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { languageFromPath } from '@awapi/shared';

/**
 * Minimal monaco surface we depend on. Defining it explicitly (rather
 * than importing `monaco-editor` here) lets tests inject a fake without
 * pulling Monaco's web-worker bundle into jsdom.
 */
export interface MonacoLike {
  editor: {
    createDiffEditor(
      container: HTMLElement,
      options?: Record<string, unknown>,
    ): MonacoDiffEditor;
    createModel(value: string, language?: string): MonacoModel;
  };
}

export interface MonacoDiffEditor {
  setModel(model: { original: MonacoModel; modified: MonacoModel }): void;
  layout(): void;
  dispose(): void;
}

export interface MonacoModel {
  getValue(): string;
  setValue(value: string): void;
  onDidChangeContent(cb: () => void): { dispose(): void };
  dispose(): void;
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
  /** Lazy Monaco loader; overridable for tests. */
  monacoLoader?: MonacoLoader;
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
    monacoLoader = defaultLoader,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoDiffEditor | null>(null);
  const monacoRef = useRef<MonacoLike | null>(null);
  const modelsRef = useRef<{ original: MonacoModel; modified: MonacoModel } | null>(null);
  const subscriptionsRef = useRef<Array<{ dispose(): void }>>([]);
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
        const original = monaco.editor.createModel(leftText ?? '', lang);
        const modified = monaco.editor.createModel(rightText ?? '', lang);
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
  useEffect(() => {
    if (editorState !== 'ready') return;
    const m = modelsRef.current;
    if (!m) return;
    if (leftText !== null && m.original.getValue() !== leftText) {
      m.original.setValue(leftText);
      setLeftDirty(false);
    }
    if (rightText !== null && m.modified.getValue() !== rightText) {
      m.modified.setValue(rightText);
      setRightDirty(false);
    }
    // The container size is often 0 while React was still painting
    // the initial frame; force a re-layout once content arrives.
    editorRef.current?.layout();
  }, [leftText, rightText, editorState]);

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

  return (
    <section className="awapi-textdiff" aria-label={`Text diff for ${relPath}`}>
      <header className="awapi-textdiff__toolbar" role="toolbar">
        <span className="awapi-textdiff__title">{relPath}</span>
        {editableLeft ? (
          <button
            type="button"
            disabled={!leftDirty || saving !== null}
            onClick={() => handleSave('left')}
          >
            {saving === 'left' ? 'Saving…' : leftDirty ? 'Save left' : 'Saved'}
          </button>
        ) : null}
        {editableRight ? (
          <button
            type="button"
            disabled={!rightDirty || saving !== null}
            onClick={() => handleSave('right')}
          >
            {saving === 'right' ? 'Saving…' : rightDirty ? 'Save right' : 'Saved'}
          </button>
        ) : null}
        {editorState === 'loading' ? <span>Loading editor…</span> : null}
        {editorState === 'error' ? (
          <span className="awapi-textdiff__error">Editor failed: {editorError}</span>
        ) : null}
      </header>
      <div ref={containerRef} className="awapi-textdiff__editor" />
    </section>
  );
}
