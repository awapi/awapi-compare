import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  FS_ERROR_EXTERNAL_MODIFICATION,
  classifyFile,
  type ComparedPair,
  type CompareMode,
  type DiffStatus,
} from '@awapi/shared';
import { useFileDiffData } from '../useFileDiffData.js';
import { joinPath, basename, extname } from '../paths.js';
import { getSessionStore } from '../state/sessionRegistry.js';
import { useThemeStore, useWorkspaceStore, useRecentsStore } from '../state/stores.js';
import {
  registerTabSaveHandler,
  unregisterTabSaveHandler,
} from '../state/tabSaveRegistry.js';
import type { ThemeName } from '../state/themeStore.js';
import { getPalette, statusLabel } from '../theme.js';
import type { ViewFilter } from '../viewFilter.js';
import { Toolbar } from './Toolbar.js';
import { TextDiffView, type TextDiffActions } from './TextDiffView.js';
import { HexDiffView } from './HexDiffView.js';
import { ImageDiffView } from './ImageDiffView.js';
import { CreateMissingSideDialog } from './CreateMissingSideDialog.js';

export interface FileDiffTabProps {
  /** Pair-key (relPath) the tab is bound to. */
  relPath: string;
  /**
   * The compared pair, if known. Used to seed the initial paths and
   * the bottom summary panes when the file has not finished loading.
   */
  pair?: ComparedPair;
  /** Id of the compare tab whose scan produced this file diff. */
  parentCompareTabId?: string;
  /**
   * Workspace tab id. When provided, dirty-state changes from the
   * embedded text diff bubble back to the workspace store so the tab
   * title can render an unsaved-changes marker.
   */
  tabId?: string;
  /** Open the global rules editor (toolbar `Rules` button). */
  onOpenRules?: () => void;
  /** Open the diff-options dialog (toolbar `Match` button). */
  onOpenDiffOptions?: () => void;
}

interface RootPair {
  leftRoot: string;
  rightRoot: string;
}

/**
 * File-diff tab. Renders the same toolbar / path-bar chrome as the
 * folder-compare tab, with editable absolute paths so the user can
 * repoint either side to a different file. Underneath, picks a text /
 * hex / image viewer based on the file's content kind and surfaces an
 * inline-edit + save flow with external-modification detection.
 */
export function FileDiffTab({
  relPath,
  pair: pairProp,
  parentCompareTabId,
  tabId,
  onOpenRules,
  onOpenDiffOptions,
}: FileDiffTabProps): JSX.Element {
  if (!parentCompareTabId) {
    return (
      <FileDiffBody
        relPath={relPath}
        initialPair={pairProp}
        roots={null}
        tabId={tabId}
        onOpenRules={onOpenRules}
        onOpenDiffOptions={onOpenDiffOptions}
      />
    );
  }
  return (
    <SessionBoundFileDiffBody
      relPath={relPath}
      pairProp={pairProp}
      parentCompareTabId={parentCompareTabId}
      tabId={tabId}
      onOpenRules={onOpenRules}
      onOpenDiffOptions={onOpenDiffOptions}
    />
  );
}

function SessionBoundFileDiffBody({
  relPath,
  pairProp,
  parentCompareTabId,
  tabId,
  onOpenRules,
  onOpenDiffOptions,
}: {
  relPath: string;
  pairProp?: ComparedPair;
  parentCompareTabId: string;
  tabId?: string;
  onOpenRules?: () => void;
  onOpenDiffOptions?: () => void;
}): JSX.Element {
  // Subscribe to the parent compare session so the file-diff tab can
  // seed its initial paths from the most recent scan. The store is
  // keyed by tab id; `useMemo` keeps the hook stable across renders.
  const useSession = useMemo(() => getSessionStore(parentCompareTabId), [parentCompareTabId]);
  const leftRoot = useSession((s) => s.leftRoot);
  const rightRoot = useSession((s) => s.rightRoot);
  const pairs = useSession((s) => s.pairs);
  const lookedUpPair = useMemo(
    () => pairs.find((p) => p.relPath === relPath),
    [pairs, relPath],
  );
  const initialPair = pairProp ?? lookedUpPair;
  const roots: RootPair | null = leftRoot || rightRoot ? { leftRoot, rightRoot } : null;
  return (
    <FileDiffBody
      relPath={relPath}
      initialPair={initialPair}
      roots={roots}
      tabId={tabId}
      onOpenRules={onOpenRules}
      onOpenDiffOptions={onOpenDiffOptions}
    />
  );
}

function FileDiffBody({
  relPath,
  initialPair,
  roots,
  tabId,
  onOpenRules,
  onOpenDiffOptions,
}: {
  relPath: string;
  initialPair?: ComparedPair;
  roots: RootPair | null;
  tabId?: string;
  onOpenRules?: () => void;
  onOpenDiffOptions?: () => void;
}): JSX.Element {
  // Compute the initial absolute paths exactly once. Subsequent edits
  // (via the path inputs / Swap button / Browse) are owned by local
  // state, so the file tab is independent of the parent session.
  const [seededLeft] = useState<string>(() =>
    initialPair?.left && roots ? joinPath(roots.leftRoot, initialPair.left.relPath) : '',
  );
  const [seededRight] = useState<string>(() =>
    initialPair?.right && roots ? joinPath(roots.rightRoot, initialPair.right.relPath) : '',
  );

  const [leftPath, setLeftPath] = useState<string>(seededLeft);
  const [rightPath, setRightPath] = useState<string>(seededRight);
  const [mode, setMode] = useState<CompareMode>('quick');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [leftDirty, setLeftDirty] = useState(false);
  const [rightDirty, setRightDirty] = useState(false);
  const [saving, setSaving] = useState<'left' | 'right' | null>(null);
  // Confirmation dialog state for "Copy → Right" / "Copy ← Left"
  // when the destination side does not exist yet. The destination
  // path is computed from the current side path (if non-empty) or
  // derived from the parent folder-compare roots + the source side's
  // relPath.
  const [createPrompt, setCreatePrompt] = useState<{
    direction: 'leftToRight' | 'rightToLeft';
    sourcePath: string;
    destinationPath: string;
    target: string;
  } | null>(null);
  const textDiffActionsRef = useRef<TextDiffActions | null>(null);
  // Mirror dirty state into refs so the tab save handler (registered
  // once on mount) can read the LATEST values without re-registering
  // on every render.
  const leftDirtyRef = useRef(false);
  leftDirtyRef.current = leftDirty;
  const rightDirtyRef = useRef(false);
  rightDirtyRef.current = rightDirty;

  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  // Recent file paths (15 newest per side), surfaced in the toolbar's
  // path inputs as a native combobox.
  const fileRecents = useRecentsStore((s) => s.recents);
  const addRecent = useRecentsStore((s) => s.add);
  const leftRecents = fileRecents['file:left'];
  const rightRecents = fileRecents['file:right'];

  const setTabDirty = useWorkspaceStore((s) => s.setTabDirty);
  const handleDirtyChange = useCallback(
    (state: { left: boolean; right: boolean }) => {
      setLeftDirty(state.left);
      setRightDirty(state.right);
      if (!tabId) return;
      setTabDirty(tabId, state.left || state.right);
    },
    [setTabDirty, tabId],
  );
  // Clear the dirty flag when the file-diff tab unmounts (e.g. user
  // closed it) so a stale `*` cannot linger on a re-opened tab.
  useEffect(() => {
    return () => {
      if (tabId) setTabDirty(tabId, false);
    };
  }, [setTabDirty, tabId]);

  // Register a save handler so the workspace-level close-and-quit
  // flow (App.tsx) can flush this tab's edits when the user picks
  // "Save" on the unsaved-changes prompt.
  useEffect(() => {
    if (!tabId) return;
    registerTabSaveHandler(tabId, async () => {
      const actions = textDiffActionsRef.current;
      if (!actions) return;
      // Save left first (if dirty), then right. Sequential so the
      // toolbar's `saving` state correctly transitions through both
      // sides and a failure on either aborts the rest.
      if (leftDirtyRef.current) await actions.saveLeft();
      if (rightDirtyRef.current) await actions.saveRight();
    });
    return () => unregisterTabSaveHandler(tabId);
  }, [tabId]);

  const data = useFileDiffData({
    leftPath: leftPath.trim() ? leftPath : null,
    rightPath: rightPath.trim() ? rightPath : null,
    extensionHint: extname(leftPath || rightPath || relPath),
  });

  // Record file paths in the recents list once their content has
  // successfully loaded. This avoids polluting the dropdown with
  // typos / missing files.
  useEffect(() => {
    if (data.left.state === 'ready' && data.left.path) {
      addRecent('file', 'left', data.left.path);
    }
  }, [data.left.state, data.left.path, addRecent]);
  useEffect(() => {
    if (data.right.state === 'ready' && data.right.path) {
      addRecent('file', 'right', data.right.path);
    }
  }, [data.right.state, data.right.path, addRecent]);

  // True iff the user has not changed paths since the tab opened, in
  // which case the parent-session-supplied `pair` (with its status
  // verdict) still corresponds to the file shown.
  const pathsMatchInitial = leftPath === seededLeft && rightPath === seededRight;
  const pair = pathsMatchInitial ? initialPair : undefined;

  const handleSave = useCallback(
    async (side: 'left' | 'right', value: string) => {
      const target = side === 'left' ? data.left : data.right;
      if (!target.path) return;
      setSaveError(null);
      try {
        await window.awapi?.fs.write({
          path: target.path,
          contents: value,
          encoding: 'utf8',
          expectedMtimeMs: target.mtimeMs,
        });
        // Refresh ONLY the side we just wrote so its mtime snapshot
        // is up-to-date for the next save's external-modification
        // check. Reloading both sides would clobber unsaved edits on
        // the other side.
        data.reloadSide(side);
      } catch (err) {
        const errObj = err as { code?: string; message?: string };
        if (errObj.code === FS_ERROR_EXTERNAL_MODIFICATION) {
          const reload = window.confirm(
            `${target.path}\n\nThis file was modified outside AwapiCompare since it was loaded.\n\n` +
              'Click OK to reload from disk (your edits will be discarded), or Cancel to keep editing.',
          );
          if (reload) data.reload();
          else setSaveError('Save aborted: external modification detected.');
          return;
        }
        setSaveError(errObj.message ?? String(err));
      }
    },
    [data],
  );

  const handleRefresh = useCallback(async () => {
    if (!leftDirty && !rightDirty) {
      data.reload();
      return;
    }
    const choice = await window.awapi?.dialog?.confirmUnsaved?.({ name: relPath });
    if (choice === 'cancel' || choice === undefined) return;
    if (choice === 'save') {
      const actions = textDiffActionsRef.current;
      if (actions) {
        try {
          if (leftDirtyRef.current) await actions.saveLeft();
          if (rightDirtyRef.current) await actions.saveRight();
        } catch {
          return;
        }
      }
    } else {
      textDiffActionsRef.current?.discardEdits();
    }
    data.reload();
  }, [leftDirty, rightDirty, data, relPath]);

  // Triggered from the Monaco context menu ("Copy → Right" / "Copy
  // ← Left") when the destination side is not editable because it
  // does not exist yet. We surface a confirmation dialog instead of
  // silently no-oping; on confirm the source file is copied verbatim
  // (no overwrite — the destination is supposed to be missing) and
  // the destination path is set, so `useFileDiffData` reloads it.
  const requestCreateMissingSide = useCallback(
    (direction: 'toLeft' | 'toRight') => {
      if (!window.awapi) return;
      const sourceSide = direction === 'toLeft' ? data.right : data.left;
      if (sourceSide.state !== 'ready' || !sourceSide.path) {
        setSaveError(
          `Cannot create ${direction === 'toLeft' ? 'left' : 'right'} file: source file is not loaded.`,
        );
        return;
      }
      // Prefer an explicitly-set destination path; otherwise derive
      // it from the parent folder-compare roots + the existing
      // side's relPath.
      let destPath = (direction === 'toLeft' ? leftPath : rightPath).trim();
      if (!destPath) {
        const sourceEntry = direction === 'toLeft' ? initialPair?.right : initialPair?.left;
        const destRoot = direction === 'toLeft' ? roots?.leftRoot : roots?.rightRoot;
        if (sourceEntry && destRoot) {
          destPath = joinPath(destRoot, sourceEntry.relPath);
        }
      }
      if (!destPath) {
        setSaveError(
          `Set a ${direction === 'toLeft' ? 'left' : 'right'} file path before copying.`,
        );
        return;
      }
      setSaveError(null);
      setCreatePrompt({
        direction: direction === 'toLeft' ? 'rightToLeft' : 'leftToRight',
        sourcePath: sourceSide.path,
        destinationPath: destPath,
        target: basename(destPath),
      });
    },
    [data.left, data.right, leftPath, rightPath, initialPair, roots],
  );

  const performCreateMissingSide = useCallback(
    async (prompt: {
      direction: 'leftToRight' | 'rightToLeft';
      sourcePath: string;
      destinationPath: string;
    }) => {
      if (!window.awapi) return;
      try {
        const result = await window.awapi.fs.copy({
          from: prompt.sourcePath,
          to: prompt.destinationPath,
          overwrite: false,
        });
        if (result.errors.length > 0) {
          const first = result.errors[0];
          setSaveError(`Create failed: ${first?.message ?? 'unknown error'}`);
          return;
        }
        // Point the destination side at the newly-created file. If
        // the path was already set (e.g. user typed it), the value
        // is unchanged — fall back to a side-reload so the new
        // bytes are picked up.
        if (prompt.direction === 'rightToLeft') {
          if (leftPath !== prompt.destinationPath) setLeftPath(prompt.destinationPath);
          else data.reloadSide('left');
        } else {
          if (rightPath !== prompt.destinationPath) setRightPath(prompt.destinationPath);
          else data.reloadSide('right');
        }
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      }
    },
    [data, leftPath, rightPath],
  );

  const onPickLeftFile = useCallback(async () => {
    if (!window.awapi?.dialog?.pickFile) return;
    const picked = await window.awapi.dialog.pickFile({
      defaultPath: leftPath || rightPath || undefined,
      title: 'Select left file',
    });
    if (picked) {
      setLeftPath(picked);
      addRecent('file', 'left', picked);
    }
  }, [leftPath, rightPath, addRecent]);

  const onPickRightFile = useCallback(async () => {
    if (!window.awapi?.dialog?.pickFile) return;
    const picked = await window.awapi.dialog.pickFile({
      defaultPath: rightPath || leftPath || undefined,
      title: 'Select right file',
    });
    if (picked) {
      setRightPath(picked);
      addRecent('file', 'right', picked);
    }
  }, [leftPath, rightPath, addRecent]);

  const scanning = data.left.state === 'loading' || data.right.state === 'loading';

  const editableLeft = data.left.state === 'ready' && viewFilter === 'all';
  const editableRight = data.right.state === 'ready' && viewFilter === 'all';
  // Surface the Monaco "Copy → Right" / "Copy ← Left" actions as a
  // create-confirm flow when the destination side does not yet
  // exist. Only enable when the SOURCE side is loaded; otherwise the
  // copy would have nothing to write.
  const canCreateLeft = data.left.state === 'absent' && data.right.state === 'ready';
  const canCreateRight = data.right.state === 'absent' && data.left.state === 'ready';
  const handleCreateMissingSide = useCallback(
    (direction: 'toLeft' | 'toRight') => {
      if (direction === 'toLeft' && !canCreateLeft) return;
      if (direction === 'toRight' && !canCreateRight) return;
      requestCreateMissingSide(direction);
    },
    [canCreateLeft, canCreateRight, requestCreateMissingSide],
  );
  const handleSaveLeftClick = useCallback(() => {
    void textDiffActionsRef.current?.saveLeft();
  }, []);
  const handleSaveRightClick = useCallback(() => {
    void textDiffActionsRef.current?.saveRight();
  }, []);

  return (
    <section className="awapi-file-diff" aria-label={`File diff for ${relPath}`}>
      <Toolbar
        leftRoot={leftPath}
        rightRoot={rightPath}
        mode={mode}
        scanning={scanning}
        viewFilter={viewFilter}
        leftRecents={leftRecents}
        rightRecents={rightRecents}
        onViewFilterChange={setViewFilter}
        theme={theme}
        onLeftRootChange={setLeftPath}
        onRightRootChange={setRightPath}
        onModeChange={setMode}
        onRefresh={() => void handleRefresh()}
        onSubmitPaths={() => void handleRefresh()}
        onToggleTheme={toggleTheme}
        onOpenRules={onOpenRules ?? (() => undefined)}
        onOpenDiffOptions={onOpenDiffOptions}
        onPickLeftFolder={onPickLeftFile}
        onPickRightFolder={onPickRightFile}
        pathLabel="file"
        showMode={false}
        onSaveLeft={handleSaveLeftClick}
        onSaveRight={handleSaveRightClick}
        leftEditable={editableLeft}
        rightEditable={editableRight}
        leftDirty={leftDirty}
        rightDirty={rightDirty}
        saving={saving}
      />
      <div className="awapi-file-diff__content">
        {!pair && !leftPath && !rightPath ? (
          <p className="awapi-file-diff__notice">
            No matching pair for <code>{relPath}</code> in the current scan result. Click
            Refresh to re-run the comparison.
          </p>
        ) : (
          <FileDiffViewSwitcher
            relPath={relPath}
            viewFilter={viewFilter}
            data={data}
            saveError={saveError}
            onSave={handleSave}
            onDirtyChange={handleDirtyChange}
            onSavingChange={setSaving}
            actionsRef={textDiffActionsRef}
            onCreateMissingSide={
              canCreateLeft || canCreateRight ? handleCreateMissingSide : undefined
            }
          />
        )}
      </div>
      <FileDiffLegend status={pair?.status} theme={theme} />
      {createPrompt ? (
        <CreateMissingSideDialog
          direction={createPrompt.direction}
          target={createPrompt.target}
          sourcePath={createPrompt.sourcePath}
          destinationPath={createPrompt.destinationPath}
          onCancel={() => setCreatePrompt(null)}
          onConfirm={() => {
            const prompt = createPrompt;
            setCreatePrompt(null);
            void performCreateMissingSide(prompt);
          }}
        />
      ) : null}
    </section>
  );
}

function FileDiffViewSwitcher({
  relPath,
  data,
  saveError,
  onSave,
  onDirtyChange,
  onSavingChange,
  actionsRef,
  viewFilter,
  onCreateMissingSide,
}: {
  relPath: string;
  data: ReturnType<typeof useFileDiffData>;
  saveError: string | null;
  onSave: (side: 'left' | 'right', value: string) => Promise<void>;
  onDirtyChange?: (state: { left: boolean; right: boolean }) => void;
  onSavingChange?: (saving: 'left' | 'right' | null) => void;
  actionsRef?: React.MutableRefObject<TextDiffActions | null>;
  viewFilter: ViewFilter;
  onCreateMissingSide?: (direction: 'toLeft' | 'toRight') => void;
}): JSX.Element {
  const blockingState = unconfirmedOrTooLarge(data);
  if (blockingState === 'unconfirmed') {
    return (
      <div className="awapi-file-diff__warn" role="alertdialog" aria-live="polite">
        <p>
          One or both files are larger than the soft limit. Loading them may slow down the
          editor.
        </p>
        <button type="button" onClick={data.confirmLarge}>
          Open anyway
        </button>
      </div>
    );
  }
  if (blockingState === 'too-large') {
    return (
      <p className="awapi-file-diff__warn awapi-file-diff__warn--hard">
        One or both files exceed the hard read cap and cannot be displayed. Use the CLI or
        external tools.
      </p>
    );
  }

  const left = data.left.bytes ?? null;
  const right = data.right.bytes ?? null;
  const sniff = left ?? right;
  const sniffResult = sniff ? classifyFile(sniff, extname(relPath)) : { kind: 'binary' as const };
  const kind = data.kind ?? sniffResult.kind;

  return (
    <>
      {data.left.state === 'loading' || data.right.state === 'loading' ? (
        <p className="awapi-file-diff__notice">Loading…</p>
      ) : null}
      {data.left.state === 'error' ? (
        <p className="awapi-file-diff__error">Left: {data.left.error}</p>
      ) : null}
      {data.right.state === 'error' ? (
        <p className="awapi-file-diff__error">Right: {data.right.error}</p>
      ) : null}
      {saveError ? <p className="awapi-file-diff__error">Save: {saveError}</p> : null}
      {kind === 'text' ? (
        <TextDiffView
          relPath={relPath}
          leftText={data.left.state === 'absent' ? '' : (data.left.text ?? null)}
          rightText={data.right.state === 'absent' ? '' : (data.right.text ?? null)}
          editableLeft={data.left.state === 'ready' && viewFilter === 'all'}
          editableRight={data.right.state === 'ready' && viewFilter === 'all'}
          viewFilter={viewFilter}
          onSave={onSave}
          onDirtyChange={onDirtyChange}
          onSavingChange={onSavingChange}
          actionsRef={actionsRef}
          onCreateMissingSide={onCreateMissingSide}
        />
      ) : kind === 'image' ? (
        <ImageDiffView left={left} right={right} imageFormat={sniffResult.imageFormat} />
      ) : (
        <HexDiffView left={left} right={right} viewFilter={viewFilter} />
      )}
    </>
  );
}

function unconfirmedOrTooLarge(
  data: ReturnType<typeof useFileDiffData>,
): 'unconfirmed' | 'too-large' | null {
  if (data.left.state === 'too-large' || data.right.state === 'too-large') return 'too-large';
  if (data.left.state === 'unconfirmed' || data.right.state === 'unconfirmed') {
    return 'unconfirmed';
  }
  return null;
}

/**
 * Statuses meaningful for a single file pair. `excluded` only applies
 * during a folder scan, so it's omitted from the legend here.
 */
const FILE_LEGEND_ORDER: readonly DiffStatus[] = [
  'identical',
  'different',
  'newer-left',
  'newer-right',
  'left-only',
  'right-only',
  'error',
];

function FileDiffLegend({
  status,
  theme,
}: {
  status?: DiffStatus;
  theme: ThemeName;
}): JSX.Element {
  const palette = getPalette(theme);
  return (
    <footer
      className="awapi-statusbar awapi-file-diff__legend"
      role="status"
      aria-label="Diff status legend"
    >
      {FILE_LEGEND_ORDER.map((s) => {
        const active = s === status;
        return (
          <span
            key={s}
            className={`awapi-statusbar__chip${active ? ' awapi-statusbar__chip--active' : ''}`}
            title={statusLabel(s)}
          >
            <span
              className="awapi-statusbar__dot"
              style={{ backgroundColor: palette.status[s] }}
              aria-hidden="true"
            />
            {statusLabel(s)}
          </span>
        );
      })}
    </footer>
  );
}
