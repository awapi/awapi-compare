import type { JSX } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ComparedPair } from '@awapi/shared';
import { getPalette, statusLabel } from '../theme.js';
import { formatMtime, formatSize, statusGlyph } from '../format.js';
import type { ThemeName } from '../state/themeStore.js';
import { buildTreeRows, collectDirPaths } from '../treeRows.js';

export interface DiffTableProps {
  pairs: readonly ComparedPair[];
  selectedPath?: string | null;
  theme: ThemeName;
  onSelect?: (relPath: string) => void;
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
  const { pairs, selectedPath, theme, onSelect, onActivate, onContextMenu } = props;
  const palette = getPalette(theme);
  const parentRef = useRef<HTMLDivElement>(null);

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
              const isSelected = selectedPath === pair.relPath;
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
                  onClick={() => onSelect?.(pair.relPath)}
                  onDoubleClick={() => {
                    if (isDir && hasChildren) toggle(pair.relPath);
                    else onActivate?.(pair.relPath);
                  }}
                  onContextMenu={(event) => {
                    if (!onContextMenu) return;
                    event.preventDefault();
                    onSelect?.(pair.relPath);
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
  onToggle: () => void;
}

function TreeCellLead(props: TreeCellLeadProps): JSX.Element {
  const { indent, isDir, hasChildren, expanded, onToggle } = props;
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
      <span className="awapi-diff-tree__icon" aria-hidden="true">
        {isDir ? '📁' : '📄'}
      </span>
    </>
  );
}
