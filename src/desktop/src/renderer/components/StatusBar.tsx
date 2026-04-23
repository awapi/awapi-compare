import type { JSX } from 'react';
import type { DiffStatus, ScanProgress } from '@awapi/shared';
import type { DiffSummary } from '../diffSummary.js';
import { getPalette, statusLabel } from '../theme.js';
import type { ThemeName } from '../state/themeStore.js';

export interface StatusBarProps {
  summary: DiffSummary;
  progress?: ScanProgress | null;
  scanning: boolean;
  theme: ThemeName;
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

export function StatusBar({ summary, progress, scanning, theme }: StatusBarProps): JSX.Element {
  const palette = getPalette(theme);
  return (
    <footer className="awapi-statusbar" role="status" aria-live="polite">
      <span>Total: {summary.total}</span>
      {DISPLAY_ORDER.map((status) => (
        <span key={status} className="awapi-statusbar__chip" title={statusLabel(status)}>
          <span
            className="awapi-statusbar__dot"
            style={{ backgroundColor: palette.status[status] }}
            aria-hidden="true"
          />
          {statusLabel(status)}: {summary[status]}
        </span>
      ))}
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
