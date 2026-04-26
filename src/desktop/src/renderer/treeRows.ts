import type { ComparedPair, DiffStatus } from '@awapi/shared';

/**
 * One row in the rendered diff tree. The renderer maps these to
 * virtualised DOM rows; the shape is also what Beyond Compare-style
 * tree navigation operates on.
 */
export interface TreeRow {
  pair: ComparedPair;
  /** 0 for top-level entries, +1 for each nested directory level. */
  depth: number;
  isDir: boolean;
  hasChildren: boolean;
  expanded: boolean;
  /**
   * Status used to colour the row. For files this is `pair.status`. For
   * directories the diff service classifies them as `'identical'` (since
   * a dir has no comparable content of its own), so we aggregate from
   * descendants here: a directory whose subtree contains any differing
   * entry is rendered as `'different'`, matching Beyond Compare's
   * behaviour.
   */
  displayStatus: DiffStatus;
}

interface Node {
  pair: ComparedPair;
  isDir: boolean;
  children: Node[];
}

function parentOf(relPath: string): string {
  const i = Math.max(relPath.lastIndexOf('/'), relPath.lastIndexOf('\\'));
  return i < 0 ? '' : relPath.slice(0, i);
}

function isDirPair(pair: ComparedPair): boolean {
  return pair.left?.type === 'dir' || pair.right?.type === 'dir';
}

function nameOf(pair: ComparedPair): string {
  return (pair.left?.name ?? pair.right?.name ?? pair.relPath).toLowerCase();
}

function compareNodes(a: Node, b: Node): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  const an = nameOf(a.pair);
  const bn = nameOf(b.pair);
  if (an < bn) return -1;
  if (an > bn) return 1;
  return 0;
}

/**
 * Build the visible row list from a flat list of `ComparedPair`s by
 * grouping children under their parent directory and skipping the
 * descendants of any collapsed directory. Pure & electron-free so it
 * is unit-testable without a renderer.
 */
export function buildTreeRows(
  pairs: readonly ComparedPair[],
  collapsed: ReadonlySet<string>,
): TreeRow[] {
  if (pairs.length === 0) return [];

  const nodes = new Map<string, Node>();
  for (const pair of pairs) {
    nodes.set(pair.relPath, { pair, isDir: isDirPair(pair), children: [] });
  }

  const roots: Node[] = [];
  for (const node of nodes.values()) {
    const parent = parentOf(node.pair.relPath);
    if (parent === '') {
      roots.push(node);
      continue;
    }
    const parentNode = nodes.get(parent);
    if (parentNode) {
      parentNode.children.push(node);
    } else {
      // Orphan: parent directory not represented as a pair (e.g. the
      // user's rules excluded it). Surface the row at the root rather
      // than dropping it.
      roots.push(node);
    }
  }

  for (const node of nodes.values()) {
    node.children.sort(compareNodes);
  }
  roots.sort(compareNodes);

  const rows: TreeRow[] = [];
  const walk = (node: Node, depth: number): void => {
    const expanded = node.isDir && !collapsed.has(node.pair.relPath);
    rows.push({
      pair: node.pair,
      depth,
      isDir: node.isDir,
      hasChildren: node.children.length > 0,
      expanded,
      displayStatus: node.isDir
        ? aggregateDirStatus(node)
        : node.pair.status,
    });
    if (!expanded) return;
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return rows;
}

/**
 * Returns the set of relPaths for every directory node in `pairs`.
 * Used by the renderer to (e.g.) collapse-all in one click.
 */
export function collectDirPaths(pairs: readonly ComparedPair[]): string[] {
  const out: string[] = [];
  for (const pair of pairs) {
    if (isDirPair(pair)) out.push(pair.relPath);
  }
  return out;
}

/**
 * Statuses that mean a child entry differs between the two sides. Used
 * to roll a directory's display status up from its descendants.
 */
const DIFFERING_STATUSES: ReadonlySet<DiffStatus> = new Set<DiffStatus>([
  'left-only',
  'right-only',
  'different',
  'newer-left',
  'newer-right',
  'error',
]);

/**
 * Compute the colour-bearing status for a directory node by walking its
 * subtree. Preserves an inherent `left-only` / `right-only` / `error` /
 * `excluded` status on the directory itself; otherwise reports
 * `'different'` if any descendant differs and `'identical'` when the
 * subtree is fully in sync.
 */
function aggregateDirStatus(node: Node): DiffStatus {
  const own = node.pair.status;
  if (own === 'left-only' || own === 'right-only' || own === 'error' || own === 'excluded') {
    return own;
  }
  const stack: Node[] = [...node.children];
  while (stack.length > 0) {
    const current = stack.pop() as Node;
    const status = current.isDir ? aggregateDirStatus(current) : current.pair.status;
    if (DIFFERING_STATUSES.has(status)) return 'different';
  }
  return 'identical';
}
