import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ComparedPair } from '@awapi/shared';
import { getPalette, statusLabel } from '../theme.js';
import { formatMtime, formatSize, statusGlyph } from '../format.js';
import type { ThemeName } from '../state/themeStore.js';
import { buildTreeRows, collectDirPaths } from '../treeRows.js';

export interface DiffTableProps {
  pairs: readonly ComparedPair[];
  selectedPaths?: ReadonlySet<string>;
  theme: ThemeName;
  onSelectionChange?: (paths: ReadonlySet<string>, primary: string | null) => void;
  onActivate?: (relPath: string) => void;
  onContextMenu?: (relPath: string, side: 'left' | 'right', x: number, y: number) => void;
}

const ROW_HEIGHT = 24;
const INDENT_PX = 16;

/**
 * Twin virtualized tree/table: left side, center status, right side.
 * Pairs are arranged into a directory tree (Beyond Compare style) so
 * folders contain their children rather than every file appearing as a
 * flat list. Expansion state is tracked locally by relPath.
 */
export function DiffTable(props: DiffTableProps): JSX.Element {
  const { pairs, selectedPaths, theme, onSelectionChange, onActivate, onContextMenu } = props;
  const palette = getPalette(theme);
  const parentRef = useRef<HTMLDivElement>(null);
  const anchorPathRef = useRef<string | null>(null);

  // Drag-to-select state. We use refs so the mouseenter handler doesn't
  // close over stale values from the render that initiated the drag.
  const dragAnchorIdxRef = useRef<number | null>(null);
  const dragBaseSelectionRef = useRef<ReadonlySet<string>>(new Set());
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  // Kept in sync below (after rows is computed) so mouseenter handlers
  // always read the latest virtualised row list without stale closures.
  const rowsRef = useRef<ReturnType<typeof buildTreeRows>>([]);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  // Directories default to collapsed: build the `collapsed` set buildTreeRows
  // expects as `allDirPaths \ expanded`. Recomputed whenever pairs change so
  // a fresh compare starts collapsed without forgetting paths the user has
  // explicitly opened.
  const collapsed = useMemo(() => {
    const dirs = collectDirPaths(pairs);
    const result = new Set<string>();
    for (const dir of dirs) {
      if (!expanded.has(dir)) result.add(dir);
    }
    return result;
  }, [pairs, expanded]);

  const rows = useMemo(() => buildTreeRows(pairs, collapsed), [pairs, collapsed]);
  rowsRef.current = rows;

  // End drag-select when the mouse button is released anywhere.
  useEffect(() => {
    const onMouseUp = () => {
      dragAnchorIdxRef.current = null;
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, []);

  const toggle = useCallback((relPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }, []);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  return (
    <div className="awapi-diff-wrap">
      <div className="awapi-diff-colheader" role="row">
        <div role="columnheader">Name</div>
        <div role="columnheader">Size</div>
        <div role="columnheader">Modified</div>
        <div role="columnheader" aria-label="Status">
          {' '}
        </div>
        <div role="columnheader">Name</div>
        <div role="columnheader">Size</div>
        <div role="columnheader">Modified</div>
      </div>
      <div
        className="awapi-diff-table"
        ref={parentRef}
        role="grid"
        aria-label="Folder compare results"
        aria-rowcount={rows.length}
      >
        {rows.length === 0 ? (
          <div className="awapi-diff-table__empty">
            Pick a left or right folder to list its contents, or both to compare.
          </div>
        ) : (
          <div
            className="awapi-diff-table__body"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              const { pair, depth, isDir, hasChildren, expanded, displayStatus } = row;
              const isSelected = selectedPaths?.has(pair.relPath) ?? false;
              const color = palette.status[displayStatus];
              const indent = depth * INDENT_PX;
              return (
                <div
                  key={pair.relPath}
                  className="awapi-diff-row"
                  role="row"
                  aria-selected={isSelected}
                  aria-rowindex={virtualRow.index + 1}
                  aria-level={depth + 1}
                  aria-expanded={isDir ? expanded : undefined}
                  style={{
                    height: ROW_HEIGHT,
                    transform: `translateY(${virtualRow.start}px)`,
                    color,
                  }}
                  onClick={(e) => {
                    const isShift = e.shiftKey;
                    const isCtrl = e.ctrlKey || e.metaKey;
                    if (isShift && anchorPathRef.current !== null) {
                      const anchorIdx = rows.findIndex(
                        (r) => r.pair.relPath === anchorPathRef.current,
                      );
                      const clickedIdx = virtualRow.index;
                      const lo = Math.min(anchorIdx, clickedIdx);
                      const hi = Math.max(anchorIdx, clickedIdx);
                      const range = new Set(
                        rows.slice(lo, hi + 1).map((r) => r.pair.relPath),
                      );
                      onSelectionChange?.(range, pair.relPath);
                    } else if (isCtrl) {
                      const next = new Set(selectedPaths ?? []);
                      if (next.has(pair.relPath)) next.delete(pair.relPath);
                      else next.add(pair.relPath);
                      anchorPathRef.current = pair.relPath;
                      onSelectionChange?.(next, pair.relPath);
                    } else {
                      anchorPathRef.current = pair.relPath;
                      onSelectionChange?.(new Set([pair.relPath]), pair.relPath);
                    }
                  }}
                  onMouseDown={(e) => {
                    // Start drag-select only on plain left button (no modifier).
                    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
                    e.preventDefault(); // prevent focus/text-selection side-effects
                    dragAnchorIdxRef.current = virtualRow.index;
                    // Snapshot the current selection so Ctrl+drag (not
                    // implemented yet) would be additive; for plain drag we
                    // start fresh from this row.
                    dragBaseSelectionRef.current = new Set();
                    anchorPathRef.current = pair.relPath;
                    onSelectionChangeRef.current?.(new Set([pair.relPath]), pair.relPath);
                  }}
                  onMouseEnter={() => {
                    if (dragAnchorIdxRef.current === null) return;
                    const lo = Math.min(dragAnchorIdxRef.current, virtualRow.index);
                    const hi = Math.max(dragAnchorIdxRef.current, virtualRow.index);
                    const range = new Set(
                      rowsRef.current.slice(lo, hi + 1).map((r) => r.pair.relPath),
                    );
                    onSelectionChangeRef.current?.(range, pair.relPath);
                  }}
                  onDoubleClick={() => {
                    if (isDir && hasChildren) toggle(pair.relPath);
                    else onActivate?.(pair.relPath);
                  }}
                  onContextMenu={(event) => {
                    if (!onContextMenu) return;
                    event.preventDefault();
                    // If right-clicking a row not already in the selection,
                    // single-select it; otherwise keep the multi-selection.
                    if (!(selectedPaths?.has(pair.relPath) ?? false)) {
                      anchorPathRef.current = pair.relPath;
                      onSelectionChange?.(new Set([pair.relPath]), pair.relPath);
                    }
                    // Detect which side of the row was clicked. Cells
                    // carry a `data-side` attribute; the centre status
                    // cell falls back to the side that has an entry.
                    const target = event.target as HTMLElement | null;
                    const cell = target?.closest('[data-side]') as
                      | HTMLElement
                      | null;
                    const attr = cell?.dataset.side;
                    let side: 'left' | 'right';
                    if (attr === 'left' || attr === 'right') {
                      side = attr;
                    } else {
                      side = pair.left ? 'left' : 'right';
                    }
                    onContextMenu(pair.relPath, side, event.clientX, event.clientY);
                  }}
                >
                  <div className="awapi-diff-cell" role="gridcell" data-side="left">
                    <TreeCellLead
                      indent={indent}
                      isDir={isDir}
                      hasChildren={hasChildren}
                      expanded={expanded}
                      exists={!!pair.left}
                      onToggle={() => toggle(pair.relPath)}
                    />
                    <span className="awapi-diff-cell__name">
                      {pair.left?.name ?? ''}
                    </span>
                  </div>
                  <div
                    className="awapi-diff-cell awapi-diff-cell--meta"
                    role="gridcell"
                    data-side="left"
                  >
                    {pair.left && pair.left.type !== 'dir'
                      ? formatSize(pair.left.size)
                      : ''}
                  </div>
                  <div
                    className="awapi-diff-cell awapi-diff-cell--meta"
                    role="gridcell"
                    data-side="left"
                  >
                    {formatMtime(pair.left?.mtimeMs)}
                  </div>
                  <div
                    className="awapi-diff-cell awapi-diff-cell--center"
                    role="gridcell"
                    title={statusLabel(displayStatus)}
                    aria-label={statusLabel(displayStatus)}
                  >
                    {statusGlyph(displayStatus)}
                  </div>
                  <div className="awapi-diff-cell" role="gridcell" data-side="right">
                    {/* Right pane mirrors the left indentation so rows
                        line up across the divider. */}
                    <span
                      className="awapi-diff-tree__spacer"
                      style={{ width: indent }}
                      aria-hidden="true"
                    />
                    <span
                      className="awapi-diff-tree__chevron awapi-diff-tree__chevron--leaf"
                      aria-hidden="true"
                    />
                    {pair.right && (
                      <span className="awapi-diff-tree__icon" aria-hidden="true">
                        {isDir ? '📁' : '📄'}
                      </span>
                    )}
                    <span className="awapi-diff-cell__name">
                      {pair.right?.name ?? ''}
                    </span>
                  </div>
                  <div
                    className="awapi-diff-cell awapi-diff-cell--meta"
                    role="gridcell"
                    data-side="right"
                  >
                    {pair.right && pair.right.type !== 'dir'
                      ? formatSize(pair.right.size)
                      : ''}
                  </div>
                  <div
                    className="awapi-diff-cell awapi-diff-cell--meta"
                    role="gridcell"
                    data-side="right"
                  >
                    {formatMtime(pair.right?.mtimeMs)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface TreeCellLeadProps {
  indent: number;
  isDir: boolean;
  hasChildren: boolean;
  expanded: boolean;
  exists: boolean;
  onToggle: () => void;
}

function TreeCellLead(props: TreeCellLeadProps): JSX.Element {
  const { indent, isDir, hasChildren, expanded, exists, onToggle } = props;
  return (
    <>
      <span
        className="awapi-diff-tree__spacer"
        style={{ width: indent }}
        aria-hidden="true"
      />
      {isDir && hasChildren ? (
        <button
          type="button"
          className="awapi-diff-tree__chevron"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {expanded ? '▾' : '▸'}
        </button>
      ) : (
        <span
          className="awapi-diff-tree__chevron awapi-diff-tree__chevron--leaf"
          aria-hidden="true"
        />
      )}
      {exists && (
        <span className="awapi-diff-tree__icon" aria-hidden="true">
          {isDir ? '📁' : '📄'}
        </span>
      )}
    </>
  );
}
