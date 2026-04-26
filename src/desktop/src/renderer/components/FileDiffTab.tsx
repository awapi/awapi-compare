import { useCallback, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  FS_ERROR_EXTERNAL_MODIFICATION,
  classifyFile,
  type ComparedPair,
  type CompareMode,
  type DiffStatus,
} from '@awapi/shared';
import { useFileDiffData } from '../useFileDiffData.js';
import { joinPath, extname } from '../paths.js';
import { getSessionStore } from '../state/sessionRegistry.js';
import { useThemeStore } from '../state/stores.js';
import type { ThemeName } from '../state/themeStore.js';
import { getPalette, statusLabel } from '../theme.js';
import { Toolbar } from './Toolbar.js';
import { TextDiffView } from './TextDiffView.js';
import { HexDiffView } from './HexDiffView.js';
import { ImageDiffView } from './ImageDiffView.js';

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
  onOpenRules,
  onOpenDiffOptions,
}: FileDiffTabProps): JSX.Element {
  if (!parentCompareTabId) {
    return (
      <FileDiffBody
        relPath={relPath}
        initialPair={pairProp}
        roots={null}
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
      onOpenRules={onOpenRules}
      onOpenDiffOptions={onOpenDiffOptions}
    />
  );
}

function SessionBoundFileDiffBody({
  relPath,
  pairProp,
  parentCompareTabId,
  onOpenRules,
  onOpenDiffOptions,
}: {
  relPath: string;
  pairProp?: ComparedPair;
  parentCompareTabId: string;
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
      onOpenRules={onOpenRules}
      onOpenDiffOptions={onOpenDiffOptions}
    />
  );
}

function FileDiffBody({
  relPath,
  initialPair,
  roots,
  onOpenRules,
  onOpenDiffOptions,
}: {
  relPath: string;
  initialPair?: ComparedPair;
  roots: RootPair | null;
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
  const [saveError, setSaveError] = useState<string | null>(null);

  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const data = useFileDiffData({
    leftPath: leftPath.trim() ? leftPath : null,
    rightPath: rightPath.trim() ? rightPath : null,
    extensionHint: extname(leftPath || rightPath || relPath),
  });

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
        data.reload();
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

  const reload = useCallback(() => data.reload(), [data]);

  const onPickLeftFile = useCallback(async () => {
    if (!window.awapi?.dialog?.pickFile) return;
    const picked = await window.awapi.dialog.pickFile({
      defaultPath: leftPath || rightPath || undefined,
      title: 'Select left file',
    });
    if (picked) setLeftPath(picked);
  }, [leftPath, rightPath]);

  const onPickRightFile = useCallback(async () => {
    if (!window.awapi?.dialog?.pickFile) return;
    const picked = await window.awapi.dialog.pickFile({
      defaultPath: rightPath || leftPath || undefined,
      title: 'Select right file',
    });
    if (picked) setRightPath(picked);
  }, [leftPath, rightPath]);

  const scanning = data.left.state === 'loading' || data.right.state === 'loading';

  return (
    <section className="awapi-file-diff" aria-label={`File diff for ${relPath}`}>
      <Toolbar
        leftRoot={leftPath}
        rightRoot={rightPath}
        mode={mode}
        scanning={scanning}
        theme={theme}
        onLeftRootChange={setLeftPath}
        onRightRootChange={setRightPath}
        onModeChange={setMode}
        onRefresh={reload}
        onToggleTheme={toggleTheme}
        onOpenRules={onOpenRules ?? (() => undefined)}
        onOpenDiffOptions={onOpenDiffOptions}
        onPickLeftFolder={onPickLeftFile}
        onPickRightFolder={onPickRightFile}
        pathLabel="file"
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
            data={data}
            saveError={saveError}
            onSave={handleSave}
          />
        )}
      </div>
      <FileDiffLegend status={pair?.status} theme={theme} />
    </section>
  );
}

function FileDiffViewSwitcher({
  relPath,
  data,
  saveError,
  onSave,
}: {
  relPath: string;
  data: ReturnType<typeof useFileDiffData>;
  saveError: string | null;
  onSave: (side: 'left' | 'right', value: string) => Promise<void>;
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
          editableLeft={data.left.state === 'ready'}
          editableRight={data.right.state === 'ready'}
          onSave={onSave}
        />
      ) : kind === 'image' ? (
        <ImageDiffView left={left} right={right} imageFormat={sniffResult.imageFormat} />
      ) : (
        <HexDiffView left={left} right={right} />
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
