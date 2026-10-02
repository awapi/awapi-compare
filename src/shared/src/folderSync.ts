import type { ComparedPair, EntryType } from './types.js';

/**
 * How a folder sync reconciles the two sides.
 *
 * - `mirror-*`: make the destination identical to the source. Source-only
 *   entries are copied, differing entries are overwritten (whichever side is
 *   newer) and destination-only entries are **deleted**.
 * - `update-*`: copy source-only and source-newer entries to the destination.
 *   Nothing is ever deleted and newer destination files are left alone.
 * - `two-way`: copy orphans to the opposite side and the newer file of each
 *   differing pair over the older one. Nothing is deleted.
 */
export type FolderSyncMode =
  | 'mirror-left-to-right'
  | 'mirror-right-to-left'
  | 'update-left-to-right'
  | 'update-right-to-left'
  | 'two-way';

export const FOLDER_SYNC_MODES: readonly FolderSyncMode[] = [
  'mirror-left-to-right',
  'mirror-right-to-left',
  'update-left-to-right',
  'update-right-to-left',
  'two-way',
];

export const FOLDER_SYNC_MODE_LABELS: Readonly<Record<FolderSyncMode, string>> = {
  'mirror-left-to-right': 'Mirror left → right',
  'mirror-right-to-left': 'Mirror right → left',
  'update-left-to-right': 'Update left → right',
  'update-right-to-left': 'Update right → left',
  'two-way': 'Two-way sync',
};

export const FOLDER_SYNC_MODE_DESCRIPTIONS: Readonly<Record<FolderSyncMode, string>> = {
  'mirror-left-to-right':
    'Make the right folder identical to the left one. Right-only items are deleted.',
  'mirror-right-to-left':
    'Make the left folder identical to the right one. Left-only items are deleted.',
  'update-left-to-right':
    'Copy new and newer items from left to right. Nothing is deleted.',
  'update-right-to-left':
    'Copy new and newer items from right to left. Nothing is deleted.',
  'two-way':
    'Copy new items to the other side and the newer version of each file over the older one. Nothing is deleted.',
};

export type FolderSyncOp =
  | 'copy-left-to-right'
  | 'copy-right-to-left'
  | 'delete-left'
  | 'delete-right';

export interface FolderSyncItem {
  relPath: string;
  op: FolderSyncOp;
  /** Type of the entry the operation acts on (a folder op covers its contents). */
  entryType: EntryType;
  /** True when a copy replaces an existing destination entry. */
  overwrite: boolean;
}

/** A pair the sync cannot resolve on its own; it is reported and left untouched. */
export interface FolderSyncConflict {
  relPath: string;
  reason: string;
}

export interface FolderSyncSummary {
  copyLeftToRight: number;
  copyRightToLeft: number;
  deleteLeft: number;
  deleteRight: number;
  conflicts: number;
}

export interface FolderSyncPlan {
  mode: FolderSyncMode;
  /** Copies first, then deletions, each sorted by `relPath`. */
  items: FolderSyncItem[];
  conflicts: FolderSyncConflict[];
  summary: FolderSyncSummary;
}

type Direction = 'left-to-right' | 'right-to-left';

const REASON_TYPE_MISMATCH = 'File on one side, folder on the other';
const REASON_UNKNOWN_NEWER = 'Differs but neither side is newer';

function sourceOf(mode: FolderSyncMode): Direction | null {
  switch (mode) {
    case 'mirror-left-to-right':
    case 'update-left-to-right':
      return 'left-to-right';
    case 'mirror-right-to-left':
    case 'update-right-to-left':
      return 'right-to-left';
    case 'two-way':
      return null;
  }
}

function copyOp(direction: Direction): FolderSyncOp {
  return direction === 'left-to-right' ? 'copy-left-to-right' : 'copy-right-to-left';
}

function deleteOp(side: 'left' | 'right'): FolderSyncOp {
  return side === 'left' ? 'delete-left' : 'delete-right';
}

/**
 * Build the list of operations needed to sync a compared folder pair under
 * `mode`. Pure and side-effect free: the result doubles as the dry-run
 * preview and as the input to the executor.
 *
 * Folder entries that are copied or deleted as a whole absorb the operations
 * of their descendants, because the underlying copy/remove is recursive.
 * `identical`, `excluded` and `error` pairs never produce an operation.
 */
export function planFolderSync(
  pairs: readonly ComparedPair[],
  mode: FolderSyncMode,
): FolderSyncPlan {
  const mirror = mode === 'mirror-left-to-right' || mode === 'mirror-right-to-left';
  const source = sourceOf(mode);
  const raw: FolderSyncItem[] = [];
  const conflicts: FolderSyncConflict[] = [];

  for (const pair of pairs) {
    const { left, right, relPath } = pair;
    switch (pair.status) {
      case 'left-only': {
        if (!left) break;
        if (source === 'right-to-left') {
          if (mirror) {
            raw.push({ relPath, op: deleteOp('left'), entryType: left.type, overwrite: false });
          }
        } else {
          raw.push({ relPath, op: copyOp('left-to-right'), entryType: left.type, overwrite: false });
        }
        break;
      }
      case 'right-only': {
        if (!right) break;
        if (source === 'left-to-right') {
          if (mirror) {
            raw.push({ relPath, op: deleteOp('right'), entryType: right.type, overwrite: false });
          }
        } else {
          raw.push({ relPath, op: copyOp('right-to-left'), entryType: right.type, overwrite: false });
        }
        break;
      }
      case 'newer-left':
      case 'newer-right':
      case 'different': {
        if (!left || !right) break;
        if (left.type !== right.type) {
          conflicts.push({ relPath, reason: REASON_TYPE_MISMATCH });
          break;
        }
        const newer: Direction | null =
          pair.status === 'newer-left'
            ? 'left-to-right'
            : pair.status === 'newer-right'
              ? 'right-to-left'
              : null;
        if (mirror) {
          // Whatever the timestamps say, the destination must match the source.
          raw.push({ relPath, op: copyOp(source as Direction), entryType: left.type, overwrite: true });
        } else if (newer === null) {
          conflicts.push({ relPath, reason: REASON_UNKNOWN_NEWER });
        } else if (source === null || source === newer) {
          raw.push({ relPath, op: copyOp(newer), entryType: left.type, overwrite: true });
        }
        // `update-*` with a newer destination: leave it alone.
        break;
      }
      case 'identical':
      case 'excluded':
      case 'error':
        break;
    }
  }

  const items = collapseFolderOps(raw);
  const rank = (op: FolderSyncOp): number => (op.startsWith('copy') ? 0 : 1);
  items.sort((a, b) => rank(a.op) - rank(b.op) || compareRelPath(a.relPath, b.relPath));
  conflicts.sort((a, b) => compareRelPath(a.relPath, b.relPath));

  return { mode, items, conflicts, summary: summarizeItems(items, conflicts.length) };
}

function compareRelPath(a: string, b: string): number {
  return a < b ? -1 : 1;
}

/** Drop operations that are already covered by the same operation on an ancestor folder. */
function collapseFolderOps(items: readonly FolderSyncItem[]): FolderSyncItem[] {
  const folderOps = new Map<FolderSyncOp, string[]>();
  for (const item of items) {
    if (item.entryType !== 'dir') continue;
    const list = folderOps.get(item.op) ?? [];
    list.push(item.relPath);
    folderOps.set(item.op, list);
  }
  return items.filter((item) => {
    const folders = folderOps.get(item.op);
    if (!folders) return true;
    return !folders.some((dir) => item.relPath.startsWith(`${dir}/`));
  });
}

function summarizeItems(items: readonly FolderSyncItem[], conflicts: number): FolderSyncSummary {
  const summary: FolderSyncSummary = {
    copyLeftToRight: 0,
    copyRightToLeft: 0,
    deleteLeft: 0,
    deleteRight: 0,
    conflicts,
  };
  for (const item of items) {
    switch (item.op) {
      case 'copy-left-to-right':
        summary.copyLeftToRight += 1;
        break;
      case 'copy-right-to-left':
        summary.copyRightToLeft += 1;
        break;
      case 'delete-left':
        summary.deleteLeft += 1;
        break;
      case 'delete-right':
        summary.deleteRight += 1;
        break;
    }
  }
  return summary;
}

/** Total number of deletions in a plan (used to gate the destructive confirmation). */
export function countFolderSyncDeletes(plan: FolderSyncPlan): number {
  return plan.summary.deleteLeft + plan.summary.deleteRight;
}
