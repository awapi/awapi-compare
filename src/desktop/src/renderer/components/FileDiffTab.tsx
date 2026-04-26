import { useCallback, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  FS_ERROR_EXTERNAL_MODIFICATION,
  classifyFile,
  type ComparedPair,
} from '@awapi/shared';
import { formatMtime, formatSize, statusGlyph } from '../format.js';
import { statusLabel } from '../theme.js';
import { useFileDiffData } from '../useFileDiffData.js';
import { joinPath, extname } from '../paths.js';
import { getSessionStore } from '../state/sessionRegistry.js';
import { TextDiffView } from './TextDiffView.js';
import { HexDiffView } from './HexDiffView.js';
import { ImageDiffView } from './ImageDiffView.js';

export interface FileDiffTabProps {
  /** Pair-key (relPath) the tab is bound to. */
  relPath: string;
  /**
   * The compared pair, if known. If omitted, the component will look
   * the pair up in the parent compare-session's store.
   */
  pair?: ComparedPair;
  /** Id of the compare tab whose scan produced this file diff. */
  parentCompareTabId?: string;
}

interface RootPair {
  leftRoot: string;
  rightRoot: string;
}

/**
 * File-diff tab. Phase 7 wiring: chooses a text / hex / image viewer
 * based on the file's content kind and surfaces an inline-edit + save
 * flow with external-modification detection.
 */
export function FileDiffTab({
  relPath,
  pair: pairProp,
  parentCompareTabId,
}: FileDiffTabProps): JSX.Element {
  if (!parentCompareTabId) {
    return <FileDiffBody relPath={relPath} pair={pairProp} roots={null} />;
  }
  return (
    <SessionBoundFileDiffBody
      relPath={relPath}
      pairProp={pairProp}
      parentCompareTabId={parentCompareTabId}
    />
  );
}

function SessionBoundFileDiffBody({
  relPath,
  pairProp,
  parentCompareTabId,
}: {
  relPath: string;
  pairProp?: ComparedPair;
  parentCompareTabId: string;
}): JSX.Element {
  // Subscribe to the parent compare session so the file-diff tab
  // refreshes when a new scan lands. The store is keyed by tab id;
  // `useMemo` keeps the hook stable across re-renders.
  const useSession = useMemo(() => getSessionStore(parentCompareTabId), [parentCompareTabId]);
  const leftRoot = useSession((s) => s.leftRoot);
  const rightRoot = useSession((s) => s.rightRoot);
  const pairs = useSession((s) => s.pairs);
  const lookedUpPair = useMemo(
    () => pairs.find((p) => p.relPath === relPath),
    [pairs, relPath],
  );
  const pair = pairProp ?? lookedUpPair;
  const roots: RootPair | null = leftRoot || rightRoot ? { leftRoot, rightRoot } : null;
  return <FileDiffBody relPath={relPath} pair={pair} roots={roots} />;
}

function FileDiffBody({
  relPath,
  pair,
  roots,
}: {
  relPath: string;
  pair?: ComparedPair;
  roots: RootPair | null;
}): JSX.Element {
  const leftPath = pair?.left && roots ? joinPath(roots.leftRoot, pair.left.relPath) : null;
  const rightPath = pair?.right && roots ? joinPath(roots.rightRoot, pair.right.relPath) : null;
  const data = useFileDiffData({
    leftPath,
    rightPath,
    extensionHint: extname(relPath),
  });
  const [saveError, setSaveError] = useState<string | null>(null);

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

  return (
    <section className="awapi-file-diff" aria-label={`File diff for ${relPath}`}>
      <header className="awapi-file-diff__header">
        <h2>{relPath}</h2>
        {pair ? (
          <span
            className="awapi-file-diff__status"
            title={statusLabel(pair.status)}
            aria-label={statusLabel(pair.status)}
          >
            {statusGlyph(pair.status)} {statusLabel(pair.status)}
          </span>
        ) : null}
      </header>
      {!pair ? (
        <p className="awapi-file-diff__notice">
          No matching pair for <code>{relPath}</code> in the current scan result. Re-run
          Compare to refresh.
        </p>
      ) : (
        <FileDiffViewSwitcher
          relPath={relPath}
          pair={pair}
          data={data}
          saveError={saveError}
          onSave={handleSave}
        />
      )}
    </section>
  );
}

function FileDiffViewSwitcher({
  relPath,
  pair,
  data,
  saveError,
  onSave,
}: {
  relPath: string;
  pair: ComparedPair;
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
          leftText={data.left.text ?? null}
          rightText={data.right.text ?? null}
          editableLeft={data.left.state === 'ready'}
          editableRight={data.right.state === 'ready'}
          onSave={onSave}
        />
      ) : kind === 'image' ? (
        <ImageDiffView left={left} right={right} imageFormat={sniffResult.imageFormat} />
      ) : (
        <HexDiffView left={left} right={right} />
      )}
      <PairMetaSummary pair={pair} />
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

function PairMetaSummary({ pair }: { pair: ComparedPair }): JSX.Element {
  return (
    <div className="awapi-file-diff__panes">
      <div className="awapi-file-diff__pane" aria-label="Left side">
        <h3>Left</h3>
        {pair.left ? (
          <dl>
            <dt>Name</dt>
            <dd>{pair.left.name}</dd>
            <dt>Size</dt>
            <dd>{formatSize(pair.left.size)}</dd>
            <dt>Modified</dt>
            <dd>{formatMtime(pair.left.mtimeMs)}</dd>
            <dt>Type</dt>
            <dd>{pair.left.type}</dd>
          </dl>
        ) : (
          <p>(absent)</p>
        )}
      </div>
      <div className="awapi-file-diff__pane" aria-label="Right side">
        <h3>Right</h3>
        {pair.right ? (
          <dl>
            <dt>Name</dt>
            <dd>{pair.right.name}</dd>
            <dt>Size</dt>
            <dd>{formatSize(pair.right.size)}</dd>
            <dt>Modified</dt>
            <dd>{formatMtime(pair.right.mtimeMs)}</dd>
            <dt>Type</dt>
            <dd>{pair.right.type}</dd>
          </dl>
        ) : (
          <p>(absent)</p>
        )}
      </div>
    </div>
  );
}
