import type { JSX } from 'react';

export interface CreateMissingSideDialogProps {
  /** Direction of the copy: which side will be created. */
  direction: 'leftToRight' | 'rightToLeft';
  /** Basename of the file (used in the message body). */
  target: string;
  /** Absolute path that will be created. */
  destinationPath: string;
  /** Absolute path of the source file being copied. */
  sourcePath: string;
  /** Confirm — kick off the create+copy. */
  onConfirm(): void;
  /** Cancel without copying. */
  onCancel(): void;
}

const TITLE: Record<CreateMissingSideDialogProps['direction'], string> = {
  leftToRight: 'Create right file',
  rightToLeft: 'Create left file',
};

const SIDE_LABEL: Record<CreateMissingSideDialogProps['direction'], string> = {
  leftToRight: 'right',
  rightToLeft: 'left',
};

const SOURCE_LABEL: Record<CreateMissingSideDialogProps['direction'], string> = {
  leftToRight: 'left',
  rightToLeft: 'right',
};

/**
 * Modal confirmation rendered before "Copy → Right" / "Copy ← Left"
 * when the destination side does not exist yet. The destination file
 * will be created as a whole-file copy of the source side.
 */
export function CreateMissingSideDialog(
  props: CreateMissingSideDialogProps,
): JSX.Element {
  const { direction, target, destinationPath, sourcePath, onConfirm, onCancel } = props;

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
            aria-label="Cancel create"
          >
            ×
          </button>
        </header>
        <div className="awapi-modal__body">
          <p>
            <strong>{target}</strong> does not exist on the {SIDE_LABEL[direction]} side.
          </p>
          <p>
            It will be created as a copy of the {SOURCE_LABEL[direction]} file.
          </p>
          <p className="awapi-modal__detail">
            <span className="awapi-modal__detail-label">From:</span> {sourcePath}
          </p>
          <p className="awapi-modal__detail">
            <span className="awapi-modal__detail-label">To:</span> {destinationPath}
          </p>
        </div>
        <footer className="awapi-modal__footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="awapi-button--primary"
            onClick={onConfirm}
            autoFocus
          >
            Create
          </button>
        </footer>
      </div>
    </div>
  );
}
