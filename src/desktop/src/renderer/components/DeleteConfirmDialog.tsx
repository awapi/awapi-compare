import { useState } from 'react';
import type { JSX } from 'react';

export interface DeleteConfirmDialogProps {
  /** Human-friendly description of what will be deleted, e.g. `"package.json"`. */
  target: string;
  /** Absolute path of the primary (clicked) side's entry. Always deleted. */
  primaryPath: string;
  /** Absolute path on the other side, if it also has an entry. */
  otherPath?: string;
  /** Which side `otherPath` belongs to (drives checkbox label). */
  otherSide?: 'left' | 'right';
  /** Whether the entries being deleted are directories (drives the warning copy). */
  isDirectory: boolean;
  /**
   * Confirm deletion.
   * @param applyToOther - true when the user checked "also delete from other side".
   */
  onConfirm(applyToOther: boolean): void;
  /** Cancel without deleting. */
  onCancel(): void;
}

/**
 * Modal confirmation rendered before a destructive `fs.rm`. Mirrors
 * the styling of {@link OverwriteConfirmDialog} so the workspace
 * feels consistent.
 */
export function DeleteConfirmDialog(props: DeleteConfirmDialogProps): JSX.Element {
  const { target, primaryPath, otherPath, otherSide, isDirectory, onConfirm, onCancel } =
    props;
  const [applyToOther, setApplyToOther] = useState(false);

  const visiblePaths =
    applyToOther && otherPath ? [primaryPath, otherPath] : [primaryPath];
  const title = isDirectory ? 'Delete folder' : 'Delete file';

  return (
    <div
      className="awapi-modal__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="awapi-modal awapi-modal--small"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="awapi-modal__header">
          <h2>{title}</h2>
          <button
            type="button"
            className="awapi-modal__close"
            onClick={onCancel}
            aria-label="Cancel delete"
          >
            ×
          </button>
        </header>
        <div className="awapi-modal__body">
          <p>
            Permanently delete <strong>{target}</strong>?
            {isDirectory ? ' All contents will be removed.' : ''}
          </p>
          <ul className="awapi-modal__detail" style={{ paddingLeft: '1.25em' }}>
            {visiblePaths.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {otherPath && otherSide ? (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5em',
                marginTop: '0.6em',
              }}
            >
              <input
                type="checkbox"
                checked={applyToOther}
                onChange={(e) => setApplyToOther(e.currentTarget.checked)}
              />
              Also delete from {otherSide} side
            </label>
          ) : null}
          <p className="awapi-modal__detail" style={{ marginTop: '0.6em' }}>
            This cannot be undone.
          </p>
        </div>
        <footer className="awapi-modal__footer">
          <button type="button" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className="awapi-button--primary"
            onClick={() => onConfirm(applyToOther)}
          >
            Delete
          </button>
        </footer>
      </div>
    </div>
  );
}
