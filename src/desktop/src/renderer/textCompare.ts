/**
 * Pure logic behind the text-compare controls (ignore options, hunk
 * classification, difference navigation). No Monaco / React / Electron
 * imports so it can be unit-tested exhaustively.
 *
 * Monaco's diff engine natively supports only "ignore leading/trailing
 * whitespace". Every other "ignore" option is implemented here as a
 * *post-classification* of Monaco's line hunks: a hunk whose two sides
 * are equal after normalisation (case folding, whitespace stripping,
 * user regexes) is flagged `ignored`. Ignored hunks are muted in the
 * editor and skipped by next / previous navigation and the counter.
 */

export interface TextCompareOptions {
  /** Native Monaco option: ignore leading / trailing whitespace changes. */
  ignoreTrimWhitespace: boolean;
  /** Treat lines as equal when they differ only in (any) whitespace. */
  ignoreAllWhitespace: boolean;
  /** Treat lines as equal when they differ only in letter case. */
  ignoreCase: boolean;
  /**
   * JavaScript regular-expression sources. Text matching any of them is
   * removed from each line before comparing ("unimportant text").
   */
  ignorePatterns: string[];
  /** `true` = two panes, `false` = single inline pane. */
  sideBySide: boolean;
  wordWrap: boolean;
}

export const DEFAULT_TEXT_COMPARE_OPTIONS: Readonly<TextCompareOptions> = Object.freeze({
  // Matches Monaco's own default so upgrading does not change results.
  ignoreTrimWhitespace: true,
  ignoreAllWhitespace: false,
  ignoreCase: false,
  ignorePatterns: [],
  sideBySide: true,
  wordWrap: false,
});

/** Upper bound on stored / applied patterns, so a bad store cannot hang the UI. */
export const MAX_IGNORE_PATTERNS = 20;

/** Coerce arbitrary (e.g. persisted JSON) input to a valid options object. */
export function sanitizeTextCompareOptions(raw: unknown): TextCompareOptions {
  const d = DEFAULT_TEXT_COMPARE_OPTIONS;
  if (typeof raw !== 'object' || raw === null) return { ...d, ignorePatterns: [] };
  const r = raw as Record<string, unknown>;
  const bool = (key: keyof TextCompareOptions, fallback: boolean): boolean =>
    typeof r[key] === 'boolean' ? (r[key] as boolean) : fallback;
  const patterns = Array.isArray(r.ignorePatterns)
    ? r.ignorePatterns
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
        .slice(0, MAX_IGNORE_PATTERNS)
    : [];
  return {
    ignoreTrimWhitespace: bool('ignoreTrimWhitespace', d.ignoreTrimWhitespace),
    ignoreAllWhitespace: bool('ignoreAllWhitespace', d.ignoreAllWhitespace),
    ignoreCase: bool('ignoreCase', d.ignoreCase),
    ignorePatterns: patterns,
    sideBySide: bool('sideBySide', d.sideBySide),
    wordWrap: bool('wordWrap', d.wordWrap),
  };
}

export interface PatternError {
  pattern: string;
  message: string;
}

export interface CompiledPatterns {
  regexes: RegExp[];
  errors: PatternError[];
}

/** Compile user patterns; invalid ones are reported and skipped. */
export function compileIgnorePatterns(patterns: readonly string[]): CompiledPatterns {
  const regexes: RegExp[] = [];
  const errors: PatternError[] = [];
  for (const pattern of patterns.slice(0, MAX_IGNORE_PATTERNS)) {
    if (pattern.length === 0) continue;
    try {
      regexes.push(new RegExp(pattern, 'g'));
    } catch (err) {
      errors.push({ pattern, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { regexes, errors };
}

/** Parse the multi-line pattern textarea (one regex per line, blanks dropped). */
export function parsePatternText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, MAX_IGNORE_PATTERNS);
}

/** True when any option beyond Monaco's native whitespace trim is active. */
export function hasSoftIgnores(options: TextCompareOptions): boolean {
  return options.ignoreAllWhitespace || options.ignoreCase || options.ignorePatterns.length > 0;
}

/**
 * Normalise a block of lines for comparison.
 *
 * - Regex matches are removed from each line first. A line that was
 *   *entirely* consumed by a match (non-blank before, blank after) is
 *   dropped, so an inserted `// comment` line can be ignored wholesale.
 * - Then case and whitespace folding are applied.
 */
export function normalizeLines(
  lines: readonly string[],
  options: Pick<TextCompareOptions, 'ignoreAllWhitespace' | 'ignoreCase'>,
  regexes: readonly RegExp[],
): string[] {
  const out: string[] = [];
  for (const line of lines) {
    let next = line;
    for (const re of regexes) {
      re.lastIndex = 0;
      next = next.replace(re, '');
    }
    if (next !== line && next.trim() === '' && line.trim() !== '') continue;
    if (options.ignoreCase) next = next.toLowerCase();
    if (options.ignoreAllWhitespace) next = next.replace(/\s+/g, '');
    out.push(next);
  }
  return out;
}

/** Structural twin of Monaco's `ILineChange` (see `MonacoLineChange`). */
export interface DiffHunk {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

export interface ClassifiedHunk {
  change: DiffHunk;
  /** `true` when the hunk only differs by ignorable text. */
  ignored: boolean;
}

export type HunkLineReader = (
  side: 'original' | 'modified',
  startLine: number,
  endLine: number,
) => string;

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

function hunkLines(
  read: HunkLineReader,
  side: 'original' | 'modified',
  change: DiffHunk,
): string[] {
  const start =
    side === 'original' ? change.originalStartLineNumber : change.modifiedStartLineNumber;
  const end = side === 'original' ? change.originalEndLineNumber : change.modifiedEndLineNumber;
  // `end === 0` means this side contributes no lines to the hunk.
  if (end === 0) return [];
  return splitLines(read(side, start, end));
}

/**
 * Flag each Monaco hunk as ignorable or not. Without any soft-ignore
 * option every hunk is important (and `read` is never called).
 */
export function classifyHunks(
  changes: readonly DiffHunk[] | null | undefined,
  read: HunkLineReader,
  options: TextCompareOptions,
  regexes: readonly RegExp[],
): ClassifiedHunk[] {
  if (!changes) return [];
  const soft = options.ignoreAllWhitespace || options.ignoreCase || regexes.length > 0;
  return changes.map((change) => {
    if (!soft) return { change, ignored: false };
    const a = normalizeLines(hunkLines(read, 'original', change), options, regexes);
    const b = normalizeLines(hunkLines(read, 'modified', change), options, regexes);
    const ignored = a.length === b.length && a.every((line, i) => line === b[i]);
    return { change, ignored };
  });
}

/** Indices (into `hunks`) of hunks that are not ignored. */
export function importantIndices(hunks: readonly ClassifiedHunk[]): number[] {
  const out: number[] = [];
  hunks.forEach((h, i) => {
    if (!h.ignored) out.push(i);
  });
  return out;
}

/**
 * Next important hunk after `current` in `direction`, wrapping around.
 * `current` is an index into `hunks` (`-1` = nothing selected yet).
 * Returns `-1` when there is no important hunk.
 */
export function stepHunk(
  hunks: readonly ClassifiedHunk[],
  current: number,
  direction: 'next' | 'previous',
): number {
  const important = importantIndices(hunks);
  if (important.length === 0) return -1;
  if (direction === 'next') {
    return important.find((i) => i > current) ?? important[0]!;
  }
  for (let k = important.length - 1; k >= 0; k -= 1) {
    const i = important[k]!;
    if (i < current) return i;
  }
  return important[important.length - 1]!;
}

/**
 * Pick the hunk to jump to from a caret position, used so that
 * next/previous continue from where the user is looking rather than a
 * stale index. Returns the index of the last hunk that starts at or
 * before `line` on the modified side (`-1` when the caret precedes
 * every hunk).
 */
export function hunkIndexAtLine(hunks: readonly ClassifiedHunk[], line: number): number {
  let found = -1;
  hunks.forEach((h, i) => {
    if (hunkRevealLine(h.change) <= line) found = i;
  });
  return found;
}

/**
 * Decide which hunk a next / previous step should start from.
 *
 * If the caret still sits on the hunk we last jumped to (or has never
 * been moved off the default 1:1), continue from `current`. Otherwise
 * the user clicked elsewhere, so continue from the hunk nearest the
 * caret.
 */
export function resolveBaseIndex(
  hunks: readonly ClassifiedHunk[],
  current: number,
  caret: { lineNumber: number; column: number } | null | undefined,
): number {
  if (!caret) return current;
  const untouched = caret.lineNumber === 1 && caret.column === 1;
  const onCurrent =
    current >= 0 &&
    current < hunks.length &&
    hunkRevealLine(hunks[current]!.change) === caret.lineNumber;
  if (untouched || onCurrent) return current;
  return hunkIndexAtLine(hunks, caret.lineNumber);
}

/** Modified-side line to scroll to when jumping to a hunk. */
export function hunkRevealLine(change: DiffHunk): number {
  return Math.max(1, change.modifiedStartLineNumber);
}

/** 1-based position of `index` among important hunks (0 when ignored / none). */
export function importantPosition(hunks: readonly ClassifiedHunk[], index: number): number {
  const pos = importantIndices(hunks).indexOf(index);
  return pos < 0 ? 0 : pos + 1;
}

export interface LineSpan {
  start: number;
  end: number;
}

/** Line spans on `side` covered by ignored hunks (for muting decorations). */
export function ignoredSpans(
  hunks: readonly ClassifiedHunk[],
  side: 'original' | 'modified',
): LineSpan[] {
  const spans: LineSpan[] = [];
  for (const { change, ignored } of hunks) {
    if (!ignored) continue;
    const start =
      side === 'original' ? change.originalStartLineNumber : change.modifiedStartLineNumber;
    const end = side === 'original' ? change.originalEndLineNumber : change.modifiedEndLineNumber;
    if (end > 0) spans.push({ start, end });
  }
  return spans;
}

export interface TextCompareSummary {
  /** Hunks that matter. */
  important: number;
  /** Hunks only differing by ignorable text. */
  ignored: number;
}

export function summarizeHunks(hunks: readonly ClassifiedHunk[]): TextCompareSummary {
  const ignored = hunks.filter((h) => h.ignored).length;
  return { important: hunks.length - ignored, ignored };
}
