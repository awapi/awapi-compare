import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import type { TextEncodingId } from '@awapi/shared';
import { basename } from '../paths.js';
import {
  loadMerge,
  saveMergeResult,
  type LoadedMerge,
  type MergeFsApi,
  type MergeInputPaths,
} from '../mergeFiles.js';
import { useThemeStore, useWorkspaceStore } from '../state/stores.js';
import type { MergePaths } from '../state/workspaceStore.js';
import { registerTabSaveHandler, unregisterTabSaveHandler } from '../state/tabSaveRegistry.js';
import { MergeView, type MergeMonacoLoader, type MergeViewActions } from './MergeView.js';

export interface MergeTabProps {
  /** Workspace tab id (dirty marker, title and close-save handler). */
  tabId: string;
  initialPaths: MergePaths;
  /** Test seam: replaces `window.awapi.fs`. */
  fsApi?: MergeFsApi;
  /** Test seam: replaces the real Monaco loader. */
  monacoLoader?: MergeMonacoLoader;
}

type PathField = keyof MergeInputPaths;

const FIELDS: ReadonlyArray<{ field: PathField; label: string; pickTitle: string }> = [
  { field: 'left', label: 'Left', pickTitle: 'Select left file (yours)' },
  { field: 'base', label: 'Base', pickTitle: 'Select base file (common ancestor)' },
  { field: 'right', label: 'Right', pickTitle: 'Select right file (theirs)' },
  { field: 'output', label: 'Output', pickTitle: 'Select output file' },
];

/**
 * Three-way merge tab: four path inputs (left, base, right, output), a
 * Load button, and the {@link MergeView}. Saving writes the result pane to
 * the output path.
 */
export function MergeTab({ tabId, initialPaths, fsApi, monacoLoader }: MergeTabProps): JSX.Element {
  const [paths, setPaths] = useState<MergeInputPaths>({
    base: initialPaths.base ?? '',
    left: initialPaths.left ?? '',
    right: initialPaths.right ?? '',
    output: initialPaths.output ?? '',
  });
  const [loaded, setLoaded] = useState<LoadedMerge | null>(null);
  const [generation, setGeneration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const theme = useThemeStore((s) => s.theme);
  const setTabDirty = useWorkspaceStore((s) => s.setTabDirty);
  const setTabTitle = useWorkspaceStore((s) => s.setTabTitle);

  const actionsRef = useRef<MergeViewActions | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const outputMtimeRef = useRef<number | undefined>(undefined);
  const loadedPathsRef = useRef<MergeInputPaths | null>(null);
  const loadTokenRef = useRef(0);

  const getFs = useCallback((): MergeFsApi | null => {
    if (fsApi) return fsApi;
    return (typeof window !== 'undefined' ? window.awapi?.fs : undefined) ?? null;
  }, [fsApi]);

  const load = useCallback(
    async (target: MergeInputPaths) => {
      const fs = getFs();
      if (!fs) {
        setError('The filesystem bridge is unavailable.');
        return;
      }
      const token = ++loadTokenRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await loadMerge(target, fs);
        if (token !== loadTokenRef.current) return;
        outputMtimeRef.current = result.outputMtimeMs;
        loadedPathsRef.current = target;
        setLoaded(result);
        setGeneration((g) => g + 1);
        setTabTitle(tabId, `Merge: ${basename(target.output.trim() || target.left)}`);
      } catch (err) {
        if (token !== loadTokenRef.current) return;
        setLoaded(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (token === loadTokenRef.current) setLoading(false);
      }
    },
    [getFs, setTabTitle, tabId],
  );

  // Auto-load when the tab opens with both sides already known (CLI launch).
  useEffect(() => {
    if (paths.left.trim() && paths.right.trim()) void load(paths);
    // Only on mount; later loads are user-initiated.
  }, []);

  const requestLoad = useCallback(() => {
    if (dirtyRef.current && !window.confirm('Discard the unsaved changes in the merge result?')) {
      return;
    }
    void load(paths);
  }, [load, paths]);

  /** Returns true when the result was written (or there was nothing to write). */
  const save = useCallback(async (): Promise<boolean> => {
    const actions = actionsRef.current;
    const target = loadedPathsRef.current;
    const fs = getFs();
    if (!actions || !target || !fs || !loaded) return false;
    const outputPath = paths.output.trim();
    if (!outputPath) {
      setError('Set an output path before saving.');
      return false;
    }
    const unresolved = actions.getUnresolvedCount();
    if (
      unresolved > 0 &&
      !window.confirm(
        `${unresolved} conflict${unresolved === 1 ? '' : 's'} still unresolved. ` +
          'Save with the conflict markers left in the file?',
      )
    ) {
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const text = actions.getResultText();
      const encoding: TextEncodingId = loaded.outputEncoding;
      let outcome = await saveMergeResult(text, encoding, outputPath, outputMtimeRef.current, fs);
      if (!outcome.ok && outcome.reason === 'external-modification') {
        if (
          !window.confirm(
            `${outputPath}\n\nThis file changed on disk since it was loaded. Overwrite it?`,
          )
        ) {
          setError('Save aborted: external modification detected.');
          return false;
        }
        outcome = await saveMergeResult(text, encoding, outputPath, undefined, fs);
      }
      if (!outcome.ok) {
        setError(outcome.message);
        return false;
      }
      outputMtimeRef.current = outcome.mtimeMs;
      actions.markSaved();
      return true;
    } finally {
      setSaving(false);
    }
  }, [getFs, loaded, paths.output]);
  const saveRef = useRef(save);
  saveRef.current = save;

  // Reflect unsaved edits in the tab and let the close-and-quit flow save them.
  useEffect(() => {
    setTabDirty(tabId, dirty);
  }, [dirty, setTabDirty, tabId]);
  useEffect(() => {
    registerTabSaveHandler(tabId, async () => {
      if (!dirtyRef.current) return;
      if (!(await saveRef.current())) throw new Error('Merge result was not saved');
    });
    return () => {
      unregisterTabSaveHandler(tabId);
      setTabDirty(tabId, false);
    };
  }, [tabId, setTabDirty]);

  const pick = useCallback(
    async (field: PathField, title: string) => {
      const pickFile = window.awapi?.dialog?.pickFile;
      if (!pickFile) return;
      const picked = await pickFile({
        title,
        defaultPath: paths[field] || paths.output || paths.left || undefined,
      });
      if (picked) setPaths((p) => ({ ...p, [field]: picked }));
    },
    [paths],
  );

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') requestLoad();
  };

  const canSave = loaded !== null && !saving && paths.output.trim() !== '';

  return (
    <section className="awapi-file-diff awapi-merge-tab" aria-label="Three-way merge">
      <div className="awapi-merge-tab__paths">
        {FIELDS.map(({ field, label, pickTitle }) => (
          <label key={field} className="awapi-merge-tab__path">
            <span className="awapi-merge-tab__path-label">{label}</span>
            <input
              type="text"
              value={paths[field]}
              spellCheck={false}
              aria-label={`${label} file path`}
              placeholder={
                field === 'base'
                  ? 'Common ancestor (optional)'
                  : field === 'output'
                    ? 'Where the merged result is saved'
                    : `${label} file`
              }
              onChange={(e) => setPaths((p) => ({ ...p, [field]: e.target.value }))}
              onKeyDown={onInputKeyDown}
            />
            <button
              type="button"
              className="awapi-textdiff__btn"
              aria-label={`Browse for ${label.toLowerCase()} file`}
              onClick={() => void pick(field, pickTitle)}
            >
              …
            </button>
          </label>
        ))}
        <div className="awapi-merge-tab__actions">
          <button
            type="button"
            className="awapi-textdiff__btn"
            onClick={requestLoad}
            disabled={loading || !paths.left.trim() || !paths.right.trim()}
          >
            {loaded ? 'Reload' : 'Load'}
          </button>
          <button
            type="button"
            className="awapi-textdiff__btn awapi-textdiff__btn--on"
            onClick={() => void save()}
            disabled={!canSave}
            title="Write the result to the output file"
          >
            {saving ? 'Saving…' : 'Save result'}
          </button>
        </div>
      </div>
      {error ? (
        <div className="awapi-merge-tab__error" role="alert">
          {error}
        </div>
      ) : null}
      {loading && !loaded ? <div className="awapi-merge-tab__hint">Loading…</div> : null}
      {!loaded && !loading && !error ? (
        <div className="awapi-merge-tab__hint">
          Choose the left and right versions (and optionally the common ancestor), then press Load.
        </div>
      ) : null}
      {loaded ? (
        <MergeView
          key={generation}
          merge={loaded.merge}
          eol={loaded.eol}
          finalNewline={loaded.finalNewline}
          language={loaded.language}
          labels={{
            base: paths.base.trim() ? basename(paths.base) : '(empty)',
            left: basename(paths.left),
            right: basename(paths.right),
            output: paths.output.trim() ? basename(paths.output) : '(not set)',
          }}
          theme={theme}
          actionsRef={actionsRef}
          onDirtyChange={setDirty}
          monacoLoader={monacoLoader}
        />
      ) : null}
    </section>
  );
}
