import { useId, useMemo, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import {
  FOLDER_SYNC_MODES,
  FOLDER_SYNC_MODE_DESCRIPTIONS,
  FOLDER_SYNC_MODE_LABELS,
  countFolderSyncDeletes,
  planFolderSync,
  type ComparedPair,
  type FolderSyncItem,
  type FolderSyncMode,
  type FolderSyncOp,
  type FolderSyncPlan,
} from '@awapi/shared';
import type { FolderSyncResult } from '../folderSyncRunner.js';
import { filterPairs } from '../viewFilter.js';

/** Preview rows rendered at once; the rest are summarised to keep the DOM small. */
const MAX_PREVIEW_ROWS = 500;

const OP_LABELS: Readonly<Record<FolderSyncOp, string>> = {
  'copy-left-to-right': 'Copy → right',
  'copy-right-to-left': 'Copy ← left',
  'delete-left': 'Delete from left',
  'delete-right': 'Delete from right',
};

export interface FolderSyncDialogProps {
  pairs: readonly ComparedPair[];
  /** Rows selected in the folder table; enables the "selected rows only" scope. */
  selectedPaths: ReadonlySet<string>;
  initialMode?: FolderSyncMode;
  /** Execute the previewed plan. Resolves once every item has been attempted. */
  onRun(plan: FolderSyncPlan, onProgress: (done: number, total: number) => void): Promise<FolderSyncResult>;
  /** Close the dialog. `didRun` is true when a sync was executed (so the caller can rescan). */
  onClose(didRun: boolean): void;
}

function describeItem(item: FolderSyncItem): string {
  const parts = [OP_LABELS[item.op]];
  if (item.entryType === 'dir') parts.push('(folder)');
  else if (item.overwrite) parts.push('(replaces)');
  return parts.join(' ');
}

export function FolderSyncDialog(props: FolderSyncDialogProps): JSX.Element {
  const { pairs, selectedPaths, initialMode = 'update-left-to-right', onRun, onClose } = props;
  const modeId = useId();
  const [mode, setMode] = useState<FolderSyncMode>(initialMode);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [confirmedDeletes, setConfirmedDeletes] = useState(false);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<FolderSyncResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const canScope = selectedPaths.size > 0;
  const scoped = selectedOnly && canScope;
  const plan = useMemo(
    () => planFolderSync(scoped ? filterPairs(pairs, 'selected', selectedPaths) : pairs, mode),
    [pairs, scoped, selectedPaths, mode],
  );
  const deletes = countFolderSyncDeletes(plan);
  const busy = running !== null;
  const finished = result !== null;
  const canRun =
    !busy && !finished && plan.items.length > 0 && (deletes === 0 || confirmedDeletes);
  const shownItems = plan.items.slice(0, MAX_PREVIEW_ROWS);
  const hiddenItems = plan.items.length - shownItems.length;

  const close = (): void => {
    if (!busy) onClose(finished);
  };

  const run = (): void => {
    setRunning({ done: 0, total: plan.items.length });
    setRunError(null);
    void onRun(plan, (done, total) => setRunning({ done, total }))
      .then(setResult)
      .catch((err: unknown) => setRunError(err instanceof Error ? err.message : String(err)))
      .finally(() => setRunning(null));
  };

  const { summary } = plan;

  return (
    <div
      className="awapi-modal__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="awapi-modal awapi-modal--medium"
        role="dialog"
        aria-modal="true"
        aria-label="Sync folders"
      >
        <header className="awapi-modal__header">
          <h2>Sync folders</h2>
          <button
            type="button"
            className="awapi-modal__close"
            onClick={close}
            aria-label="Close sync dialog"
          >
            ×
          </button>
        </header>
        <div className="awapi-modal__body">
          <div className="awapi-sync__mode">
            <label htmlFor={modeId}>Sync mode</label>
            <select
              id={modeId}
              value={mode}
              disabled={busy || finished}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                setMode(e.target.value as FolderSyncMode);
                setConfirmedDeletes(false);
              }}
            >
              {FOLDER_SYNC_MODES.map((m) => (
                <option key={m} value={m}>
                  {FOLDER_SYNC_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <p className="awapi-modal__hint">{FOLDER_SYNC_MODE_DESCRIPTIONS[mode]}</p>
          <label className="awapi-modal__checkbox">
            <input
              type="checkbox"
              checked={scoped}
              disabled={!canScope || busy || finished}
              onChange={(e) => {
                setSelectedOnly(e.currentTarget.checked);
                setConfirmedDeletes(false);
              }}
            />
            Selected rows only
          </label>

          {finished ? (
            <div role="status" className="awapi-sync__result">
              <p>
                Synced {result.succeeded} item{result.succeeded === 1 ? '' : 's'}
                {result.failed > 0
                  ? `; ${result.failed} failed`
                  : ' successfully'}
                .
              </p>
              {result.errors.length > 0 ? (
                <ul className="awapi-modal__detail awapi-sync__list">
                  {result.errors.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <>
              <p className="awapi-sync__summary" role="status">
                {plan.items.length === 0
                  ? 'Nothing to sync.'
                  : `Preview: ${summary.copyLeftToRight} copy → right, ${summary.copyRightToLeft} copy ← left, ${summary.deleteLeft + summary.deleteRight} delete`}
                {summary.conflicts > 0
                  ? ` · ${summary.conflicts} conflict${summary.conflicts === 1 ? '' : 's'} (skipped)`
                  : ''}
              </p>
              {plan.items.length > 0 ? (
                <table className="awapi-sync__table" aria-label="Sync preview">
                  <thead>
                    <tr>
                      <th scope="col">Action</th>
                      <th scope="col">Path</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownItems.map((item) => (
                      <tr
                        key={`${item.op}:${item.relPath}`}
                        className={item.op.startsWith('delete') ? 'awapi-sync__row--delete' : undefined}
                      >
                        <td>{describeItem(item)}</td>
                        <td>{item.relPath}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {hiddenItems > 0 ? (
                <p className="awapi-modal__hint">…and {hiddenItems} more.</p>
              ) : null}
              {plan.conflicts.length > 0 ? (
                <details>
                  <summary>
                    {plan.conflicts.length} conflict{plan.conflicts.length === 1 ? '' : 's'} (will be skipped)
                  </summary>
                  <ul className="awapi-modal__detail awapi-sync__list">
                    {plan.conflicts.map((c) => (
                      <li key={c.relPath}>
                        {c.relPath} — {c.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {deletes > 0 ? (
                <label className="awapi-modal__checkbox awapi-sync__warning">
                  <input
                    type="checkbox"
                    checked={confirmedDeletes}
                    disabled={busy}
                    onChange={(e) => setConfirmedDeletes(e.currentTarget.checked)}
                  />
                  Permanently delete {deletes} item{deletes === 1 ? '' : 's'} (folders include
                  their contents). This cannot be undone.
                </label>
              ) : null}
            </>
          )}
          {busy ? (
            <p role="status" className="awapi-modal__hint">
              Syncing… {running.done} / {running.total}
            </p>
          ) : null}
          {runError ? (
            <p role="alert" className="awapi-compare-body__error">
              {runError}
            </p>
          ) : null}
        </div>
        <footer className="awapi-modal__footer">
          <button type="button" onClick={close} disabled={busy}>
            {finished ? 'Close' : 'Cancel'}
          </button>
          {finished ? null : (
            <button
              type="button"
              className="awapi-button--primary"
              disabled={!canRun}
              onClick={run}
            >
              Sync
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
