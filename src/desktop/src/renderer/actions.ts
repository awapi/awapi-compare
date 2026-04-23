import type { ComparedPair, DiffStatus } from '@awapi/shared';
import type { ContextMenuItem } from './components/ContextMenu.js';

/**
 * Discrete commands that can be invoked against the currently focused
 * diff row, either via the context menu, hotkeys, or the application
 * menu. The set is kept small on purpose; everything else is a wrapper
 * over these primitives.
 */
export type RowAction =
  | 'open'
  | 'compare'
  | 'copyLeftToRight'
  | 'copyRightToLeft'
  | 'delete'
  | 'markSame'
  | 'exclude';

export interface RowActionContext {
  /** The currently selected pair, if any. */
  pair?: ComparedPair;
}

export const ROW_ACTION_LABELS: Readonly<Record<RowAction, string>> = {
  open: 'Open',
  compare: 'Compare',
  copyLeftToRight: 'Copy → Right',
  copyRightToLeft: 'Copy ← Left',
  delete: 'Delete',
  markSame: 'Mark same',
  exclude: 'Exclude',
};

export const ROW_ACTION_ACCELERATORS: Readonly<Record<RowAction, string>> = {
  open: 'F6',
  compare: 'F5',
  copyLeftToRight: 'Alt+→',
  copyRightToLeft: 'Alt+←',
  delete: 'Del',
  markSame: 'Ctrl+M',
  exclude: 'Ctrl+E',
};

const PAIR_REQUIRED: ReadonlySet<RowAction> = new Set<RowAction>([
  'open',
  'copyLeftToRight',
  'copyRightToLeft',
  'delete',
  'markSame',
  'exclude',
]);

const NEEDS_LEFT: ReadonlySet<RowAction> = new Set<RowAction>([
  'copyLeftToRight',
]);
const NEEDS_RIGHT: ReadonlySet<RowAction> = new Set<RowAction>([
  'copyRightToLeft',
]);
/** Both sides must be present for these actions. */
const NEEDS_BOTH: ReadonlySet<RowAction> = new Set<RowAction>(['markSame']);

/**
 * Pure predicate: is the action enabled for the given context? Pulled
 * out so it can be reused by the context menu, hotkey dispatch, and
 * unit tests.
 */
export function isActionEnabled(action: RowAction, ctx: RowActionContext): boolean {
  if (action === 'compare') return true;
  const { pair } = ctx;
  if (PAIR_REQUIRED.has(action) && !pair) return false;
  if (!pair) return false;
  if (NEEDS_LEFT.has(action) && !pair.left) return false;
  if (NEEDS_RIGHT.has(action) && !pair.right) return false;
  if (NEEDS_BOTH.has(action) && (!pair.left || !pair.right)) return false;
  if (action === 'delete' && !pair.left && !pair.right) return false;
  if (action === 'open' && pair.status === ('error' satisfies DiffStatus)) return false;
  return true;
}

/**
 * Build the row context-menu item list given the focused pair. The
 * order matches the application menu so users build muscle memory.
 */
export function buildRowMenuItems(ctx: RowActionContext): ContextMenuItem[] {
  const order: RowAction[] = [
    'open',
    'compare',
    'copyLeftToRight',
    'copyRightToLeft',
    'delete',
    'markSame',
    'exclude',
  ];
  return order.map((action) => ({
    action,
    label: ROW_ACTION_LABELS[action],
    accelerator: ROW_ACTION_ACCELERATORS[action],
    disabled: !isActionEnabled(action, ctx),
  }));
}
