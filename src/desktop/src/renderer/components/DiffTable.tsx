import type { JSX } from 'react';
import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ComparedPair } from '@awapi/shared';
import { getPalette, statusLabel } from '../theme.js';
import { formatMtime, formatSize, statusGlyph } from '../format.js';
import type { ThemeName } from '../state/themeStore.js';

export interface DiffTableProps {
  pairs: readonly ComparedPair[];
  selectedPath?: string | null;
  theme: ThemeName;
  onSelect?: (relPath: string) => void;
  onActivate?: (relPath: string) => void;
  onContextMenu?: (relPath: string, x: number, y: number) => void;
}

const ROW_HEIGHT = 24;

/**
 * Twin virtualized tree/table: left side, center status, right side.
 * Uses `@tanstack/react-virtual` to keep DOM size bounded for large
 * result sets. Both panels share a single scroll container, so they
 * stay perfectly row-aligned by construction.
 */
export function DiffTable(props: DiffTableProps): JSX.Element {
  const { pairs, selectedPath, theme, onSelect, onActivate, onContextMenu } = props;
  const palette = getPalette(theme);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: pairs.length,
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
        aria-rowcount={pairs.length}
      >
        {pairs.length === 0 ? (
          <div className="awapi-diff-table__empty">
            Pick a left and right folder, then click Compare.
          </div>
        ) : (
          <div
            className="awapi-diff-table__body"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const pair = pairs[virtualRow.index];
              if (!pair) return null;
              const isSelected = selectedPath === pair.relPath;
              const color = palette.status[pair.status];
              return (
                <div
                  key={pair.relPath}
                  className="awapi-diff-row"
                  role="row"
                  aria-selected={isSelected}
                  aria-rowindex={virtualRow.index + 1}
                  style={{
                    height: ROW_HEIGHT,
                    transform: `translateY(${virtualRow.start}px)`,
                    color,
                  }}
                  onClick={() => onSelect?.(pair.relPath)}
                  onDoubleClick={() => onActivate?.(pair.relPath)}
                  onContextMenu={(event) => {
                    if (!onContextMenu) return;
                    event.preventDefault();
                    onSelect?.(pair.relPath);
                    onContextMenu(pair.relPath, event.clientX, event.clientY);
                  }}
                >
                  <div className="awapi-diff-cell" role="gridcell">
                    <span className="awapi-diff-cell__name">
                      {pair.left?.name ?? ''}
                    </span>
                  </div>
                  <div
                    className="awapi-diff-cell awapi-diff-cell--meta"
                    role="gridcell"
                  >
                    {formatSize(pair.left?.size)}
                  </div>
                  <div
                    className="awapi-diff-cell awapi-diff-cell--meta"
                    role="gridcell"
                  >
                    {formatMtime(pair.left?.mtimeMs)}
                  </div>
                  <div
                    className="awapi-diff-cell awapi-diff-cell--center"
                    role="gridcell"
                    title={statusLabel(pair.status)}
                    aria-label={statusLabel(pair.status)}
                  >
                    {statusGlyph(pair.status)}
                  </div>
                  <div className="awapi-diff-cell" role="gridcell">
                    <span className="awapi-diff-cell__name">
                      {pair.right?.name ?? ''}
                    </span>
                  </div>
                  <div
                    className="awapi-diff-cell awapi-diff-cell--meta"
                    role="gridcell"
                  >
                    {formatSize(pair.right?.size)}
                  </div>
                  <div
                    className="awapi-diff-cell awapi-diff-cell--meta"
                    role="gridcell"
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
