import { useMemo, useRef } from 'react';
import type { JSX } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  HEX_DIFF_BLOCK_SIZE,
  asciiGlyph,
  diffHex,
  formatHexByte,
  formatHexOffset,
  rowSlice,
  type HexDiffSegment,
} from '@awapi/shared';

export interface HexDiffViewProps {
  /** Bytes from the left side. Pass `null` when the side is absent. */
  left: Uint8Array | null;
  /** Bytes from the right side. */
  right: Uint8Array | null;
  /**
   * Pixel height of one virtualised row. Must match the CSS row
   * height; defaults to 22.
   */
  rowHeight?: number;
}

/**
 * Per-row record for the virtualised list. Both sides are aligned on
 * the same row index after the LCS walk; one (or both) may be `null`
 * to render a blank gutter cell.
 */
interface HexRow {
  /** True when the entire row is part of an `equal` segment. */
  equal: boolean;
  leftRow: number | null;
  rightRow: number | null;
  /** Inclusive byte offset on the side that has bytes (left wins). */
  offset: number | null;
}

/**
 * Synchronised hex view. Two columns of 16-byte rows aligned by the
 * block-LCS algorithm in `@awapi/shared/hexDiff`. Virtualised so that
 * 100k-row buffers don't lag the renderer.
 */
export function HexDiffView({ left, right, rowHeight = 22 }: HexDiffViewProps): JSX.Element {
  const lBuf = left ?? EMPTY;
  const rBuf = right ?? EMPTY;
  const diff = useMemo(() => diffHex(lBuf, rBuf), [lBuf, rBuf]);
  const rows = useMemo(() => buildRows(diff.segments), [diff.segments]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  return (
    <section className="awapi-hexdiff" aria-label="Hex diff view">
      <header className="awapi-hexdiff__summary" role="status">
        {diff.identical ? (
          <span>Files are byte-identical ({diff.leftRows} rows).</span>
        ) : (
          <span>
            {diff.leftRows} left rows · {diff.rightRows} right rows ·{' '}
            {countChangeRows(diff.segments)} differing rows
            {diff.truncated ? ' (truncated)' : ''}
          </span>
        )}
      </header>
      <div className="awapi-hexdiff__body" ref={containerRef}>
        <div
          className="awapi-hexdiff__inner"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((vr) => {
            const row = rows[vr.index];
            if (!row) return null;
            return (
              <div
                key={vr.key}
                className={`awapi-hexdiff__row${row.equal ? '' : ' awapi-hexdiff__row--diff'}`}
                style={{ transform: `translateY(${vr.start}px)`, height: rowHeight }}
                role="row"
                aria-rowindex={vr.index + 1}
              >
                <span className="awapi-hexdiff__offset" role="rowheader">
                  {row.offset !== null ? formatHexOffset(row.offset) : ''}
                </span>
                <HexCell buf={lBuf} row={row.leftRow} />
                <HexCell buf={rBuf} row={row.rightRow} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function HexCell({ buf, row }: { buf: Uint8Array; row: number | null }): JSX.Element {
  if (row === null) {
    return <span className="awapi-hexdiff__cell awapi-hexdiff__cell--blank" aria-hidden />;
  }
  const slice = rowSlice(buf, row);
  const hex: string[] = [];
  const ascii: string[] = [];
  for (let i = 0; i < HEX_DIFF_BLOCK_SIZE; i += 1) {
    const byte = slice[i];
    if (byte === undefined) {
      hex.push('  ');
      ascii.push(' ');
    } else {
      hex.push(formatHexByte(byte));
      ascii.push(asciiGlyph(byte));
    }
  }
  return (
    <span className="awapi-hexdiff__cell">
      <span className="awapi-hexdiff__hex">{hex.join(' ')}</span>
      <span className="awapi-hexdiff__ascii">{ascii.join('')}</span>
    </span>
  );
}

const EMPTY = new Uint8Array(0);

function buildRows(segments: HexDiffSegment[]): HexRow[] {
  const out: HexRow[] = [];
  for (const seg of segments) {
    if (seg.kind === 'equal') {
      const leftStartRow = seg.leftOffset / HEX_DIFF_BLOCK_SIZE;
      const rightStartRow = seg.rightOffset / HEX_DIFF_BLOCK_SIZE;
      for (let i = 0; i < seg.rows; i += 1) {
        out.push({
          equal: true,
          leftRow: leftStartRow + i,
          rightRow: rightStartRow + i,
          offset: seg.leftOffset + i * HEX_DIFF_BLOCK_SIZE,
        });
      }
    } else {
      const leftStart = seg.leftOffset !== undefined ? seg.leftOffset / HEX_DIFF_BLOCK_SIZE : null;
      const rightStart =
        seg.rightOffset !== undefined ? seg.rightOffset / HEX_DIFF_BLOCK_SIZE : null;
      const span = Math.max(seg.leftRows, seg.rightRows);
      for (let i = 0; i < span; i += 1) {
        const lRow = leftStart !== null && i < seg.leftRows ? leftStart + i : null;
        const rRow = rightStart !== null && i < seg.rightRows ? rightStart + i : null;
        out.push({
          equal: false,
          leftRow: lRow,
          rightRow: rRow,
          offset:
            lRow !== null
              ? lRow * HEX_DIFF_BLOCK_SIZE
              : rRow !== null
                ? rRow * HEX_DIFF_BLOCK_SIZE
                : null,
        });
      }
    }
  }
  return out;
}

function countChangeRows(segments: HexDiffSegment[]): number {
  let n = 0;
  for (const s of segments) {
    if (s.kind === 'change') n += Math.max(s.leftRows, s.rightRows);
  }
  return n;
}

// Exported for tests.
export const __test = { buildRows, countChangeRows };
