import { useState } from 'react';
import type { JSX } from 'react';

export interface RenameDialogProps {
  /** Original basename, used as initial input value. */
  originalName: string;
  /** Which side the user did NOT right-click on; if set, show the "also rename" checkbox. */
  otherSide?: 'left' | 'right';
  /** Confirm rename with the new basename (already trimmed, non-empty). */
  onConfirm(newName: string, applyToOther: boolean): void;
  /** Cancel without renaming. */
  onCancel(): void;
}

const INVALID = /[\\/]|^\.\.?$/u;

/**
 * Modal prompt that collects a new basename. Validation is purely
 * client-side (non-empty, no path separators, not `.` or `..`); the
 * main process performs the actual filesystem-level checks.
 */
export function RenameDialog(props: RenameDialogProps): JSX.Element {
  const { originalName, otherSide, onConfirm, onCancel } = props;
  const [value, setValue] = useState(originalName);
  const [applyToOther, setApplyToOther] = useState(false);

  const trimmed = value.trim();
  const invalid =
    trimmed.length === 0 || INVALID.test(trimmed) || trimmed === originalName;

  return (
    <div
      className="awapi-modal__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        className="awapi-modal awapi-modal--small"
        role="dialog"
        aria-modal="true"
        aria-label="Rename"
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          onConfirm(trimmed, applyToOther);
        }}
      >
        <header className="awapi-modal__header">
          <h2>Rename</h2>
          <button
            type="button"
            className="awapi-modal__close"
            onClick={onCancel}
            aria-label="Cancel rename"
          >
            ×
          </button>
        </header>
        <div className="awapi-modal__body">
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.4em' }}
          >
            <span>New name</span>
            <input
              type="text"
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => {
                const dot = originalName.lastIndexOf('.');
                if (dot > 0) e.currentTarget.setSelectionRange(0, dot);
                else e.currentTarget.select();
              }}
            />
          </label>
          {otherSide ? (
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
              Also rename on {otherSide} side
            </label>
          ) : null}
        </div>
        <footer className="awapi-modal__footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="awapi-button--primary"
            disabled={invalid}
          >
            Rename
          </button>
        </footer>
      </form>
    </div>
  );
}
