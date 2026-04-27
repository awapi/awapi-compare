import { useState } from 'react';
import type { JSX } from 'react';

export interface OverwriteConfirmDialogProps {
  /**
   * Human-friendly description of what is about to be overwritten,
   * e.g. `"package.json"` or `"3 files (out of 5)"`.
   */
  target: string;
  /** Direction the copy is going, used in the dialog title. */
  direction: 'leftToRight' | 'rightToLeft';
  /**
   * Optional extra detail rendered under the main message
   * (e.g. the absolute destination path).
   */
  detail?: string;
  /**
   * Callback fired when the user clicks Overwrite. `remember` is
   * `true` when the "Don't ask again" checkbox is ticked.
   */
  onConfirm(remember: boolean): void;
  /** Cancel without copying. */
  onCancel(): void;
}

const TITLE: Record<OverwriteConfirmDialogProps['direction'], string> = {
  leftToRight: 'Copy → Right',
  rightToLeft: 'Copy ← Left',
};

/**
 * Modal confirmation rendered before a copy that would overwrite an
 * existing file on the destination side. Includes a "Don't ask
 * again" checkbox; the host component is responsible for persisting
 * the decision when `remember` is `true`.
 */
export function OverwriteConfirmDialog(
  props: OverwriteConfirmDialogProps,
): JSX.Element {
  const { target, direction, detail, onConfirm, onCancel } = props;
  const [remember, setRemember] = useState(false);

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
        aria-label={TITLE[direction]}
      >
        <header className="awapi-modal__header">
          <h2>{TITLE[direction]}</h2>
          <button
            type="button"
            className="awapi-modal__close"
            onClick={onCancel}
            aria-label="Cancel copy"
          >
            ×
          </button>
        </header>
        <div className="awapi-modal__body">
          <p>
            Overwrite <strong>{target}</strong> on the destination?
          </p>
          {detail ? <p className="awapi-modal__detail">{detail}</p> : null}
          <label className="awapi-modal__checkbox">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Don&rsquo;t ask again (you can re-enable this in Preferences)</span>
          </label>
        </div>
        <footer className="awapi-modal__footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="awapi-button--primary"
            onClick={() => onConfirm(remember)}
            autoFocus
          >
            Overwrite
          </button>
        </footer>
      </div>
    </div>
  );
}
