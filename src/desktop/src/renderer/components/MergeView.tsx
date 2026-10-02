import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, MutableRefObject } from 'react';
import {
  buildInitialResult,
  choiceLines,
  hasConflictMarkers,
  joinLines,
  stepRegion,
  type Eol,
  type Merge3Result,
  type MergeChoice,
  type MergeRegion,
  type MergeSide,
  type StepFilter,
} from '@awapi/shared';
import {
  finalizeResultText,
  regionClassName,
  regionSlot,
  slotAfterEdit,
  slotDecorationRange,
  slotEdit,
  slotIndexAtLine,
  slotLineCount,
  toLineSlot,
  type LineSlot,
  type RangeLike,
} from '../mergeEditing.js';
import { defaultLoader } from './TextDiffView.js';

// ---- Minimal Monaco surface ---------------------------------------------
// Declared here (instead of importing `monaco-editor`) so tests can inject a
// small fake without pulling Monaco's worker bundle into jsdom.

export interface MergeModelLike {
  getValue(): string;
  getValueInRange(range: RangeLike): string;
  getLineMaxColumn(line: number): number;
  onDidChangeContent(cb: () => void): { dispose(): void };
  dispose(): void;
}

export interface MergeDecoration {
  range: RangeLike;
  options: { isWholeLine?: boolean; className?: string; stickiness?: number };
}

export interface MergeDecorationsCollection {
  set(decorations: MergeDecoration[]): void;
  getRanges(): RangeLike[];
  clear(): void;
}

export interface MergeEditorLike {
  executeEdits(source: string, edits: Array<{ range: RangeLike; text: string }>): boolean;
  pushUndoStop(): void;
  revealLineInCenter(line: number): void;
  createDecorationsCollection(decorations?: MergeDecoration[]): MergeDecorationsCollection;
  onDidChangeCursorPosition(
    cb: (e: { position: { lineNumber: number; column: number } }) => void,
  ): { dispose(): void };
  dispose(): void;
}

export interface MergeMonacoLike {
  editor: {
    create(container: HTMLElement, options: Record<string, unknown>): MergeEditorLike;
    createModel(value: string, language?: string): MergeModelLike;
    TrackedRangeStickiness?: { NeverGrowsWhenTypingAtEdges: number };
  };
}

export type MergeMonacoLoader = () => Promise<MergeMonacoLike>;

const defaultMergeLoader: MergeMonacoLoader = async () =>
  (await defaultLoader()) as unknown as MergeMonacoLike;

// ---- Component ------------------------------------------------------------

/** Imperative handle for the parent tab (save flow). */
export interface MergeViewActions {
  /** Current result, with the original EOL style / final newline applied. */
  getResultText(): string;
  /** Conflicts whose marker block is still in the result. */
  getUnresolvedCount(): number;
  /** Treat the current result as saved (clears the dirty flag). */
  markSaved(): void;
}

export interface MergeViewProps {
  merge: Merge3Result;
  eol: Eol;
  finalNewline: boolean;
  language: string;
  labels: { base: string; left: string; right: string; output: string };
  theme?: 'dark' | 'light';
  actionsRef?: MutableRefObject<MergeViewActions | null>;
  onDirtyChange?(dirty: boolean): void;
  monacoLoader?: MergeMonacoLoader;
}

type EditorState = 'loading' | 'ready' | 'error';

interface Panes {
  left: MergeEditorLike;
  base: MergeEditorLike;
  right: MergeEditorLike;
  result: MergeEditorLike;
}

interface Models {
  left: MergeModelLike;
  base: MergeModelLike;
  right: MergeModelLike;
  result: MergeModelLike;
}

const SIDES: readonly MergeSide[] = ['left', 'base', 'right'];

/**
 * Three-way merge view: read-only left / base / right panes on top and an
 * editable result pane below. Every changed region is highlighted in all
 * panes; the toolbar steps through them and resolves the current one by
 * taking a side (or both) into the result. The result keeps tracking each
 * region through manual edits via Monaco decorations.
 */
export function MergeView({
  merge,
  eol,
  finalNewline,
  language,
  labels,
  theme = 'dark',
  actionsRef,
  onDirtyChange,
  monacoLoader = defaultMergeLoader,
}: MergeViewProps): JSX.Element {
  const containers = {
    left: useRef<HTMLDivElement>(null),
    base: useRef<HTMLDivElement>(null),
    right: useRef<HTMLDivElement>(null),
    result: useRef<HTMLDivElement>(null),
  };
  const [editorState, setEditorState] = useState<EditorState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [current, setCurrent] = useState(-1);
  const [unresolved, setUnresolved] = useState(0);

  const panesRef = useRef<Panes | null>(null);
  const modelsRef = useRef<Models | null>(null);
  const collectionsRef = useRef<Record<MergeSide, MergeDecorationsCollection> | null>(null);
  const resultCollectionRef = useRef<MergeDecorationsCollection | null>(null);
  const stickinessRef = useRef<number | undefined>(undefined);
  const savedValueRef = useRef('');
  const dirtyRef = useRef(false);
  const currentRef = useRef(-1);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  /** Indices (into `merge.regions`) of the regions tracked in the result pane. */
  const changed = useMemo(
    () => merge.regions.flatMap((r, i) => (r.kind === 'stable' ? [] : [i])),
    [merge],
  );
  const conflictRegions = useMemo(
    () => changed.filter((i) => merge.regions[i]?.kind === 'conflict'),
    [changed, merge],
  );

  const readSlots = useCallback(
    (): Array<LineSlot | null> => readSlotsFor(resultCollectionRef.current, changed),
    [changed],
  );

  const slotText = useCallback((slot: LineSlot): string[] => {
    const model = modelsRef.current?.result;
    if (!model || slotLineCount(slot) <= 0) return [];
    const edit = slotEdit(slot, []);
    return model.getValueInRange(edit.range).split(/\r?\n/u).slice(0, -1);
  }, []);

  /** Region indices whose conflict block has not been resolved yet. */
  const computeUnresolved = useCallback((): Set<number> => {
    const slots = readSlots();
    const out = new Set<number>();
    changed.forEach((regionIdx, k) => {
      if (merge.regions[regionIdx]?.kind !== 'conflict') return;
      const slot = slots[k];
      if (slot && hasConflictMarkers(slotText(slot))) out.add(regionIdx);
    });
    return out;
  }, [changed, merge, readSlots, slotText]);

  const refreshDecorations = useCallback(
    (unresolvedSet: Set<number>) => {
      const collections = collectionsRef.current;
      const models = modelsRef.current;
      const resultCollection = resultCollectionRef.current;
      if (!collections || !models || !resultCollection) return;
      const stickiness = stickinessRef.current;

      for (const side of SIDES) {
        const decorations: MergeDecoration[] = [];
        merge.regions.forEach((region, i) => {
          if (region.kind === 'stable') return;
          const slot = regionSlot(region, side);
          if (slotLineCount(slot) <= 0) return;
          decorations.push({
            range: {
              startLineNumber: slot.startLine,
              startColumn: 1,
              endLineNumber: slot.endLine,
              endColumn: 1,
            },
            options: {
              isWholeLine: true,
              className: regionClassName(region.kind, {
                current: i === currentRef.current,
                unresolved: unresolvedSet.has(i),
              }),
            },
          });
        });
        collections[side].set(decorations);
      }

      const ranges = resultCollection.getRanges();
      resultCollection.set(
        changed.map((regionIdx, k) => {
          const region = merge.regions[regionIdx] as MergeRegion;
          return {
            range: ranges[k] ?? slotDecorationRange({ startLine: 1, endLine: 0 }, () => 1),
            options: {
              isWholeLine: true,
              className: regionClassName(region.kind, {
                current: regionIdx === currentRef.current,
                unresolved: unresolvedSet.has(regionIdx),
              }),
              ...(stickiness !== undefined ? { stickiness } : {}),
            },
          };
        }),
      );
    },
    [changed, merge],
  );

  const refreshStatus = useCallback(() => {
    const unresolvedSet = computeUnresolved();
    setUnresolved(unresolvedSet.size);
    refreshDecorations(unresolvedSet);
  }, [computeUnresolved, refreshDecorations]);
  const refreshStatusRef = useRef(refreshStatus);
  refreshStatusRef.current = refreshStatus;

  /**
   * Make `index` the current region. `reveal` scrolls every pane to it,
   * except `skip` (the pane the user just clicked in).
   */
  const selectRegion = useCallback(
    (index: number, reveal: boolean, skip?: keyof Panes) => {
      currentRef.current = index;
      setCurrent(index);
      refreshStatusRef.current();
      const panes = panesRef.current;
      const region = merge.regions[index];
      if (!reveal || !panes || !region) return;
      for (const side of SIDES) {
        if (side === skip) continue;
        const slot = regionSlot(region, side);
        panes[side].revealLineInCenter(Math.max(1, slot.startLine));
      }
      const k = changed.indexOf(index);
      const resultSlot = k >= 0 ? readSlots()[k] : null;
      if (resultSlot && skip !== 'result') {
        panes.result.revealLineInCenter(Math.max(1, resultSlot.startLine));
      }
    },
    [changed, merge, readSlots],
  );
  const selectRegionRef = useRef(selectRegion);
  selectRegionRef.current = selectRegion;

  const step = useCallback(
    (direction: 1 | -1, filter: StepFilter) => {
      const next = stepRegion(merge.regions, currentRef.current, direction, filter);
      if (next >= 0) selectRegion(next, true);
    },
    [merge, selectRegion],
  );

  const applyChoice = useCallback(
    (choice: MergeChoice) => {
      const index = currentRef.current;
      const panes = panesRef.current;
      const models = modelsRef.current;
      const collection = resultCollectionRef.current;
      const k = changed.indexOf(index);
      if (index < 0 || k < 0 || !panes || !models || !collection) return;
      const ranges = collection.getRanges();
      const range = ranges[k];
      if (!range) return;
      const slot = toLineSlot(range);
      const lines = choiceLines(merge, index, choice);

      panes.result.pushUndoStop();
      panes.result.executeEdits('awapi-merge', [slotEdit(slot, lines)]);
      panes.result.pushUndoStop();

      // The edit replaced the region's own range, so re-pin it to the new
      // lines; neighbouring regions have been shifted by Monaco already.
      const after = collection.getRanges();
      after[k] = slotDecorationRange(slotAfterEdit(slot, lines.length), (line) =>
        models.result.getLineMaxColumn(line),
      );
      const stickiness = stickinessRef.current;
      collection.set(
        changed.map((regionIdx, kk) => ({
          range: after[kk] as RangeLike,
          options: {
            isWholeLine: true,
            className: regionClassName((merge.regions[regionIdx] as MergeRegion).kind),
            ...(stickiness !== undefined ? { stickiness } : {}),
          },
        })),
      );
      refreshStatusRef.current();
    },
    [changed, merge],
  );

  const computeUnresolvedRef = useRef(computeUnresolved);
  computeUnresolvedRef.current = computeUnresolved;

  // Mount: load Monaco, create the four editors and wire everything up.
  useEffect(() => {
    let cancelled = false;
    const disposables: Array<{ dispose(): void }> = [];
    setEditorState('loading');
    setErrorMessage(null);

    void (async () => {
      try {
        const monaco = await monacoLoader();
        if (cancelled) return;
        const { left, base, right, result } = containers;
        if (!left.current || !base.current || !right.current || !result.current) return;

        stickinessRef.current = monaco.editor.TrackedRangeStickiness?.NeverGrowsWhenTypingAtEdges;
        const initial = buildInitialResult(merge);
        const text = (lines: readonly string[]): string => joinLines(lines, '\n', true);
        const models: Models = {
          left: monaco.editor.createModel(text(merge.left), language),
          base: monaco.editor.createModel(text(merge.base), language),
          right: monaco.editor.createModel(text(merge.right), language),
          result: monaco.editor.createModel(text(initial.lines), language),
        };
        const common = {
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          theme: theme === 'dark' ? 'vs-dark' : 'vs',
        };
        const panes: Panes = {
          left: monaco.editor.create(left.current, {
            ...common,
            model: models.left,
            readOnly: true,
          }),
          base: monaco.editor.create(base.current, {
            ...common,
            model: models.base,
            readOnly: true,
          }),
          right: monaco.editor.create(right.current, {
            ...common,
            model: models.right,
            readOnly: true,
          }),
          result: monaco.editor.create(result.current, { ...common, model: models.result }),
        };
        modelsRef.current = models;
        panesRef.current = panes;
        collectionsRef.current = {
          left: panes.left.createDecorationsCollection(),
          base: panes.base.createDecorationsCollection(),
          right: panes.right.createDecorationsCollection(),
        };
        const stickiness = stickinessRef.current;
        resultCollectionRef.current = panes.result.createDecorationsCollection(
          changed.map((regionIdx) => {
            const span = initial.spans[regionIdx] as { start: number; end: number };
            return {
              range: slotDecorationRange({ startLine: span.start + 1, endLine: span.end }, (line) =>
                models.result.getLineMaxColumn(line),
              ),
              options: {
                isWholeLine: true,
                className: regionClassName((merge.regions[regionIdx] as MergeRegion).kind),
                ...(stickiness !== undefined ? { stickiness } : {}),
              },
            };
          }),
        );

        savedValueRef.current = models.result.getValue();
        dirtyRef.current = false;
        disposables.push(
          models.result.onDidChangeContent(() => {
            const dirty = models.result.getValue() !== savedValueRef.current;
            if (dirty !== dirtyRef.current) {
              dirtyRef.current = dirty;
              onDirtyChangeRef.current?.(dirty);
            }
            refreshStatusRef.current();
          }),
          panes.result.onDidChangeCursorPosition((e) => {
            const idx = slotIndexAtLine(
              readSlotsFor(resultCollectionRef.current, changed),
              e.position.lineNumber,
            );
            const regionIdx = idx >= 0 ? (changed[idx] ?? -1) : -1;
            if (regionIdx >= 0 && regionIdx !== currentRef.current) {
              selectRegionRef.current(regionIdx, true, 'result');
            }
          }),
        );
        for (const side of SIDES) {
          disposables.push(
            panes[side].onDidChangeCursorPosition((e) => {
              const slots = merge.regions.map((r) =>
                r.kind === 'stable' ? null : regionSlot(r, side),
              );
              const regionIdx = slotIndexAtLine(slots, e.position.lineNumber);
              if (regionIdx >= 0 && regionIdx !== currentRef.current) {
                selectRegionRef.current(regionIdx, true, side);
              }
            }),
          );
        }

        if (actionsRef) {
          actionsRef.current = {
            getResultText: () => finalizeResultText(models.result.getValue(), eol, finalNewline),
            getUnresolvedCount: () => computeUnresolvedRef.current().size,
            markSaved: () => {
              savedValueRef.current = models.result.getValue();
              if (dirtyRef.current) {
                dirtyRef.current = false;
                onDirtyChangeRef.current?.(false);
              }
            },
          };
        }

        setEditorState('ready');
        const first = stepRegion(
          merge.regions,
          -1,
          1,
          conflictRegions.length > 0 ? 'conflicts' : 'changes',
        );
        currentRef.current = first;
        setCurrent(first);
        refreshStatusRef.current();
        if (first >= 0) selectRegionRef.current(first, true);
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setEditorState('error');
      }
    })();

    return () => {
      cancelled = true;
      for (const d of disposables) d.dispose();
      const panes = panesRef.current;
      const models = modelsRef.current;
      if (panes)
        for (const key of ['left', 'base', 'right', 'result'] as const) panes[key].dispose();
      if (models)
        for (const key of ['left', 'base', 'right', 'result'] as const) models[key].dispose();
      panesRef.current = null;
      modelsRef.current = null;
      collectionsRef.current = null;
      resultCollectionRef.current = null;
      if (actionsRef) actionsRef.current = null;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        onDirtyChangeRef.current?.(false);
      }
      currentRef.current = -1;
      setCurrent(-1);
    };
    // The editors are rebuilt only when the merge input itself changes.
  }, [merge, language, eol, finalNewline, theme]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'F7') {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1, 'changes');
    }
  };

  const ready = editorState === 'ready';
  const position = current >= 0 ? changed.indexOf(current) + 1 : 0;
  const hasCurrent = ready && current >= 0;
  const status =
    changed.length === 0
      ? 'No differences'
      : `Change ${position > 0 ? position : '–'} of ${changed.length}` +
        (conflictRegions.length > 0
          ? unresolved > 0
            ? ` · ${unresolved} unresolved conflict${unresolved === 1 ? '' : 's'}`
            : ' · all conflicts resolved'
          : '');

  const action = (label: string, title: string, choice: MergeChoice): JSX.Element => (
    <button
      type="button"
      className="awapi-textdiff__btn"
      disabled={!hasCurrent}
      onClick={() => applyChoice(choice)}
      title={title}
    >
      {label}
    </button>
  );

  return (
    <div className="awapi-merge" onKeyDown={onKeyDown}>
      <header className="awapi-textdiff__toolbar" role="toolbar" aria-label="Three-way merge">
        <div className="awapi-textdiff__group" role="group" aria-label="Navigation">
          <button
            type="button"
            className="awapi-textdiff__btn"
            disabled={!ready || changed.length === 0}
            onClick={() => step(-1, 'changes')}
            aria-label="Previous change"
            title="Previous change (Shift+F7)"
          >
            ▲
          </button>
          <button
            type="button"
            className="awapi-textdiff__btn"
            disabled={!ready || changed.length === 0}
            onClick={() => step(1, 'changes')}
            aria-label="Next change"
            title="Next change (F7)"
          >
            ▼
          </button>
          <button
            type="button"
            className="awapi-textdiff__btn"
            disabled={!ready || conflictRegions.length === 0}
            onClick={() => step(-1, 'conflicts')}
            aria-label="Previous conflict"
            title="Previous conflict"
          >
            ◀ Conflict
          </button>
          <button
            type="button"
            className="awapi-textdiff__btn"
            disabled={!ready || conflictRegions.length === 0}
            onClick={() => step(1, 'conflicts')}
            aria-label="Next conflict"
            title="Next conflict"
          >
            Conflict ▶
          </button>
        </div>
        <div className="awapi-textdiff__group" role="group" aria-label="Resolve current change">
          {action('Take left', 'Use the left version for the current change', 'left')}
          {action('Take base', 'Use the base version for the current change', 'base')}
          {action('Take right', 'Use the right version for the current change', 'right')}
          {action('Left + right', 'Keep both, left first', 'leftThenRight')}
          {action('Right + left', 'Keep both, right first', 'rightThenLeft')}
        </div>
        <span className="awapi-textdiff__counter" role="status">
          {status}
        </span>
        {editorState === 'loading' ? (
          <span className="awapi-textdiff__status">Loading editor…</span>
        ) : null}
        {editorState === 'error' ? (
          <span className="awapi-textdiff__error" role="alert">
            Failed to load editor{errorMessage ? `: ${errorMessage}` : ''}
          </span>
        ) : null}
      </header>
      <div className="awapi-merge__top">
        {SIDES.map((side) => (
          <section key={side} className="awapi-merge__pane" aria-label={`${side} version`}>
            <div className="awapi-merge__pane-title" title={labels[side]}>
              {side === 'left' ? 'Left' : side === 'base' ? 'Base' : 'Right'}: {labels[side]}
            </div>
            <div ref={containers[side]} className="awapi-merge__editor" data-pane={side} />
          </section>
        ))}
      </div>
      <section className="awapi-merge__result" aria-label="Merge result">
        <div className="awapi-merge__pane-title" title={labels.output}>
          Result: {labels.output}
        </div>
        <div ref={containers.result} className="awapi-merge__editor" data-pane="result" />
      </section>
    </div>
  );
}

function readSlotsFor(
  collection: MergeDecorationsCollection | null,
  changed: readonly number[],
): Array<LineSlot | null> {
  const ranges = collection?.getRanges() ?? [];
  return changed.map((_i, k) => {
    const range = ranges[k];
    return range ? toLineSlot(range) : null;
  });
}
