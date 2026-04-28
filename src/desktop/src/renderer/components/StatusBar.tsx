import { useEffect, useRef, useState, type JSX } from 'react';
import type { DiffStatus, ScanProgress } from '@awapi/shared';
import type { DiffSummary } from '../diffSummary.js';
import { getPalette, statusLabel } from '../theme.js';
import type { ThemeName } from '../state/themeStore.js';

export interface StatusBarErrorEntry {
  relPath: string;
  message: string;
}

export interface StatusBarProps {
  summary: DiffSummary;
  progress?: ScanProgress | null;
  scanning: boolean;
  theme: ThemeName;
  /** Per-pair error details rendered in the error popover. */
  errors?: readonly StatusBarErrorEntry[];
}

const DISPLAY_ORDER: readonly DiffStatus[] = [
  'identical',
  'different',
  'newer-left',
  'newer-right',
  'left-only',
  'right-only',
  'excluded',
  'error',
];

const ERROR_LIST_LIMIT = 50;

export function StatusBar({
  summary,
  progress,
  scanning,
  theme,
  errors,
}: StatusBarProps): JSX.Element {
  const palette = getPalette(theme);
  const errorList = errors ?? [];
  const errorCount = summary.error;
  const hasErrors = errorCount > 0;
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  // Close the popover automatically when there are no longer any errors
  // (e.g. user re-scans and the issue clears).
  useEffect(() => {
    if (!hasErrors && open) setOpen(false);
  }, [hasErrors, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const node = wrapperRef.current;
      if (node && !node.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const renderChip = (status: DiffStatus): JSX.Element => {
    const dot = (
      <span
        className="awapi-statusbar__dot"
        style={{ backgroundColor: palette.status[status] }}
        aria-hidden="true"
      />
    );
    const labelText = `${statusLabel(status)}: ${summary[status]}`;

    if (status === 'error') {
      const interactive = hasErrors;
      return (
        <span
          key={status}
          ref={wrapperRef}
          className="awapi-statusbar__chip awapi-statusbar__chip--error"
        >
          <button
            type="button"
            className="awapi-statusbar__chip-button"
            disabled={!interactive}
            aria-haspopup="dialog"
            aria-expanded={open}
            title={interactive ? 'Click to view error details' : statusLabel('error')}
            onClick={() => {
              if (interactive) setOpen((prev) => !prev);
            }}
          >
            {dot}
            {labelText}
          </button>
          {open && interactive ? (
            <ErrorPopover errors={errorList} onClose={() => setOpen(false)} />
          ) : null}
        </span>
      );
    }

    return (
      <span key={status} className="awapi-statusbar__chip" title={statusLabel(status)}>
        {dot}
        {labelText}
      </span>
    );
  };

  return (
    <footer className="awapi-statusbar" role="status" aria-live="polite">
      <span>Total: {summary.total}</span>
      {DISPLAY_ORDER.map(renderChip)}
      <span className="awapi-statusbar__spacer" />
      {scanning && progress ? (
        <span>
          Scanning {progress.scanned}
          {progress.currentPath ? ` — ${progress.currentPath}` : ''}
        </span>
      ) : null}
    </footer>
  );
}

interface ErrorPopoverProps {
  errors: readonly StatusBarErrorEntry[];
  onClose: () => void;
}

function ErrorPopover({ errors, onClose }: ErrorPopoverProps): JSX.Element {
  const shown = errors.slice(0, ERROR_LIST_LIMIT);
  const remainder = errors.length - shown.length;
  const heading = errors.length === 1 ? '1 error' : `${errors.length} errors`;
  return (
    <div
      className="awapi-statusbar__popover"
      role="dialog"
      aria-label="Comparison errors"
      data-testid="status-error-popover"
    >
      <div className="awapi-statusbar__popover-header">
        <span>{heading}</span>
        <button
          type="button"
          className="awapi-statusbar__popover-close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <ul className="awapi-statusbar__popover-list">
        {shown.map((entry) => (
          <li key={entry.relPath} className="awapi-statusbar__popover-item">
            <div className="awapi-statusbar__popover-path" title={entry.relPath}>
              {entry.relPath}
            </div>
            {entry.message ? (
              <div className="awapi-statusbar__popover-message">{entry.message}</div>
            ) : null}
          </li>
        ))}
      </ul>
      {remainder > 0 ? (
        <div className="awapi-statusbar__popover-footer">… and {remainder} more</div>
      ) : null}
    </div>
  );
}
