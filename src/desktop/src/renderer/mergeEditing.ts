import {
  joinLines,
  splitLines,
  type Eol,
  type MergeRegion,
  type MergeRegionKind,
  type MergeSide,
} from '@awapi/shared';

/**
 * Pure helpers between the three-way merge model and the Monaco editors:
 * translating regions to 1-based line slots, building whole-line edits for
 * the result pane, and picking decoration classes. No Monaco / React
 * imports, so they are unit-tested directly.
 */

export interface RangeLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/**
 * A run of whole lines, 1-based and inclusive. `endLine === startLine - 1`
 * means an empty slot sitting just before `startLine`.
 */
export interface LineSlot {
  startLine: number;
  endLine: number;
}

export function slotLineCount(slot: LineSlot): number {
  return slot.endLine - slot.startLine + 1;
}

/** Where `region` sits in the base / left / right document. */
export function regionSlot(region: MergeRegion, side: MergeSide): LineSlot {
  const [start, end] =
    side === 'base'
      ? [region.baseStart, region.baseEnd]
      : side === 'left'
        ? [region.leftStart, region.leftEnd]
        : [region.rightStart, region.rightEnd];
  return { startLine: start + 1, endLine: end };
}

/**
 * Normalise a (possibly user-mangled) tracked decoration range to whole
 * lines. A range ending at column 1 of a later line does not include that
 * line; an empty range yields an empty slot at the next line boundary.
 */
export function toLineSlot(range: RangeLike): LineSlot {
  const empty =
    range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn;
  if (empty) {
    const line = range.startColumn > 1 ? range.startLineNumber + 1 : range.startLineNumber;
    return { startLine: line, endLine: line - 1 };
  }
  const endLine =
    range.endColumn === 1 && range.endLineNumber > range.startLineNumber
      ? range.endLineNumber - 1
      : range.endLineNumber;
  return { startLine: range.startLineNumber, endLine };
}

/** The edit that replaces every line of `slot` with `lines` (model EOL is `\n`). */
export function slotEdit(
  slot: LineSlot,
  lines: readonly string[],
): { range: RangeLike; text: string } {
  return {
    range: {
      startLineNumber: slot.startLine,
      startColumn: 1,
      endLineNumber: slot.endLine + 1,
      endColumn: 1,
    },
    text: lines.map((l) => `${l}\n`).join(''),
  };
}

/** The slot occupied after {@link slotEdit} wrote `lineCount` lines. */
export function slotAfterEdit(slot: LineSlot, lineCount: number): LineSlot {
  return { startLine: slot.startLine, endLine: slot.startLine + lineCount - 1 };
}

/** Decoration range for a slot: whole lines, or an empty range when empty. */
export function slotDecorationRange(
  slot: LineSlot,
  maxColumn: (line: number) => number,
): RangeLike {
  if (slotLineCount(slot) <= 0) {
    return {
      startLineNumber: slot.startLine,
      startColumn: 1,
      endLineNumber: slot.startLine,
      endColumn: 1,
    };
  }
  return {
    startLineNumber: slot.startLine,
    startColumn: 1,
    endLineNumber: slot.endLine,
    endColumn: maxColumn(slot.endLine),
  };
}

/** Index of the first slot containing `line`, or `-1`. Empty / `null` slots never match. */
export function slotIndexAtLine(slots: ReadonlyArray<LineSlot | null>, line: number): number {
  return slots.findIndex(
    (s) => s !== null && slotLineCount(s) > 0 && line >= s.startLine && line <= s.endLine,
  );
}

/** CSS class marking a region's lines in an editor. */
export function regionClassName(
  kind: MergeRegionKind,
  options: { unresolved?: boolean; current?: boolean } = {},
): string {
  const base = 'awapi-merge__region';
  const parts = [base];
  if (kind === 'conflict') {
    parts.push(`${base}--${options.unresolved === false ? 'resolved' : 'conflict'}`);
  } else {
    parts.push(`${base}--${kind}`);
  }
  if (options.current) parts.push(`${base}--current`);
  return parts.join(' ');
}

/**
 * Turn the result editor's text (always `\n`-separated and terminated)
 * into the text written to disk, using the original EOL style.
 */
export function finalizeResultText(modelText: string, eol: Eol, finalNewline: boolean): string {
  return joinLines(splitLines(modelText).lines, eol, finalNewline);
}
