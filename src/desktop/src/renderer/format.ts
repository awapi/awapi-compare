import type { DiffStatus } from '@awapi/shared';

/**
 * Compact single-character glyph for a diff status, rendered in the
 * center column of the twin table. Keeps the table visually scannable
 * without relying on icon fonts.
 */
export function statusGlyph(status: DiffStatus): string {
  switch (status) {
    case 'identical':
      return '=';
    case 'different':
      return '≠';
    case 'left-only':
      return '◀';
    case 'right-only':
      return '▶';
    case 'newer-left':
      return '◂';
    case 'newer-right':
      return '▸';
    case 'excluded':
      return '·';
    case 'error':
      return '!';
  }
}

/**
 * Format a byte count for display in the tree. Uses binary-prefixed
 * units (KiB, MiB, GiB) because the underlying data is always bytes.
 */
export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Format an mtime (epoch ms) as an ISO-like YYYY-MM-DD HH:MM string.
 * Empty string if undefined. Uses local time for display.
 */
export function formatMtime(mtimeMs: number | undefined): string {
  if (mtimeMs === undefined) return '';
  const d = new Date(mtimeMs);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
