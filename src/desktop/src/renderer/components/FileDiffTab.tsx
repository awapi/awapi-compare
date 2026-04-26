import { useMemo } from 'react';
import type { JSX } from 'react';
import type { ComparedPair } from '@awapi/shared';
import { formatMtime, formatSize, statusGlyph } from '../format.js';
import { statusLabel } from '../theme.js';
import { getSessionStore } from '../state/sessionRegistry.js';

export interface FileDiffTabProps {
  /** Pair-key (relPath) the tab is bound to. */
  relPath: string;
  /**
   * The compared pair, if known. If omitted, the component will look
   * the pair up in the parent compare-session's store.
   */
  pair?: ComparedPair;
  /**
   * Id of the compare tab whose scan produced this file diff. Used to
   * resolve `pair` from the per-tab session registry.
   */
  parentCompareTabId?: string;
}

/**
 * Inner subscriber: only mounted when we actually have a parent compare
 * tab to read from. Keeps the hook call unconditional.
 */
function FromParentSession({
  tabId,
  relPath,
}: {
  tabId: string;
  relPath: string;
}): JSX.Element {
  const useStore = useMemo(() => getSessionStore(tabId), [tabId]);
  const pair = useStore((s) => s.pairs.find((p) => p.relPath === relPath));
  return <FileDiffBody relPath={relPath} pair={pair} />;
}

/**
 * Phase-5 placeholder for the file-diff editor. The Monaco-based text
 * diff, hex view, and image diff land in Phase 7. For now we render a
 * read-only summary so the tabbed-workspace plumbing can be exercised.
 */
export function FileDiffTab({
  relPath,
  pair: pairProp,
  parentCompareTabId,
}: FileDiffTabProps): JSX.Element {
  if (pairProp || !parentCompareTabId) {
    return <FileDiffBody relPath={relPath} pair={pairProp} />;
  }
  return <FromParentSession tabId={parentCompareTabId} relPath={relPath} />;
}

function FileDiffBody({
  relPath,
  pair,
}: {
  relPath: string;
  pair?: ComparedPair;
}): JSX.Element {
  if (!pair) {
    return (
      <section
        className="awapi-file-diff awapi-file-diff--missing"
        aria-label={`File diff for ${relPath}`}
      >
        <p>
          No matching pair for <code>{relPath}</code> in the current scan result.
          Re-run Compare to refresh.
        </p>
      </section>
    );
  }
  return (
    <section
      className="awapi-file-diff"
      aria-label={`File diff for ${relPath}`}
    >
      <header className="awapi-file-diff__header">
        <h2>{relPath}</h2>
        <span
          className="awapi-file-diff__status"
          title={statusLabel(pair.status)}
          aria-label={statusLabel(pair.status)}
        >
          {statusGlyph(pair.status)} {statusLabel(pair.status)}
        </span>
      </header>
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
      <p className="awapi-file-diff__notice">
        Full text/binary/image diff lands in Phase 7.
      </p>
    </section>
  );
}

