import type { JSX } from 'react';

export interface UpdateCheckDialogProps {
  /** Whether a newer version is available. */
  available: boolean;
  /** The latest version string, e.g. "0.1.7" */
  version?: string;
  /** GitHub release URL to open for download. */
  url?: string;
  onClose(): void;
}

export function UpdateCheckDialog(props: UpdateCheckDialogProps): JSX.Element {
  const { available, version, url, onClose } = props;

  function handleDownload(): void {
    if (url) void window.awapi?.app?.openExternal?.(url);
  }

  return (
    <div
      className="awapi-modal__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="awapi-modal awapi-modal--small"
        role="dialog"
        aria-modal="true"
        aria-label="Check for Updates"
      >
        <header className="awapi-modal__header">
          <h2>Check for Updates</h2>
          <button
            type="button"
            className="awapi-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="awapi-modal__body">
          {available ? (
            <p>
              Version <strong>{version}</strong> is available.
            </p>
          ) : (
            <p>You&rsquo;re up to date.</p>
          )}
        </div>
        <footer className="awapi-modal__footer">
          {available && url ? (
            <button
              type="button"
              className="awapi-button--primary"
              onClick={handleDownload}
              autoFocus
            >
              Download
            </button>
          ) : null}
          <button type="button" onClick={onClose} autoFocus={!available}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
