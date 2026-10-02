import { useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  compileIgnorePatterns,
  parsePatternText,
  type TextCompareOptions,
  type TextCompareSummary,
} from '../textCompare.js';

export interface TextCompareToolbarProps {
  relPath: string;
  options: TextCompareOptions;
  onOptionsChange(patch: Partial<TextCompareOptions>): void;
  onResetOptions(): void;
  summary: TextCompareSummary;
  /** 1-based position of the current difference among important ones (0 = none selected). */
  position: number;
  onNext(): void;
  onPrevious(): void;
  onCopyToRight(): void;
  onCopyToLeft(): void;
  /** Disable the copy buttons (no difference under the caret / selected, or side not writable). */
  copyToRightDisabled: boolean;
  copyToLeftDisabled: boolean;
  /** Status message shown on the right ("Loading editor…", errors). */
  children?: React.ReactNode;
}

/**
 * Toolbar above the Monaco diff editor: difference navigation and
 * counter, per-difference copy, view toggles (inline / wrap) and the
 * "Ignore" popover. Purely presentational — state lives in the
 * text-compare store and in {@link TextDiffView}.
 */
export function TextCompareToolbar(props: TextCompareToolbarProps): JSX.Element {
  const {
    relPath,
    options,
    onOptionsChange,
    onResetOptions,
    summary,
    position,
    onNext,
    onPrevious,
    onCopyToRight,
    onCopyToLeft,
    copyToRightDisabled,
    copyToLeftDisabled,
    children,
  } = props;

  const hasDiffs = summary.important > 0;
  const counter = hasDiffs
    ? `Difference ${position > 0 ? position : '–'} of ${summary.important}`
    : summary.ignored > 0
      ? 'No important differences'
      : 'No differences';

  return (
    <header className="awapi-textdiff__toolbar" role="toolbar" aria-label="Text compare">
      <span className="awapi-textdiff__title" title={relPath}>
        {relPath}
      </span>
      <div className="awapi-textdiff__group" role="group" aria-label="Difference navigation">
        <button
          type="button"
          className="awapi-textdiff__btn"
          onClick={onPrevious}
          disabled={!hasDiffs}
          aria-label="Previous difference"
          title="Previous difference (Shift+F7)"
        >
          ▲
        </button>
        <button
          type="button"
          className="awapi-textdiff__btn"
          onClick={onNext}
          disabled={!hasDiffs}
          aria-label="Next difference"
          title="Next difference (F7)"
        >
          ▼
        </button>
        <span className="awapi-textdiff__counter" role="status" aria-live="polite">
          {counter}
          {summary.ignored > 0 ? ` · ${summary.ignored} ignored` : ''}
        </span>
      </div>
      <div className="awapi-textdiff__group" role="group" aria-label="Copy difference">
        <button
          type="button"
          className="awapi-textdiff__btn"
          onClick={onCopyToLeft}
          disabled={copyToLeftDisabled}
          aria-label="Copy difference to left"
          title="Copy the difference under the caret / selection to the left side"
        >
          ←
        </button>
        <button
          type="button"
          className="awapi-textdiff__btn"
          onClick={onCopyToRight}
          disabled={copyToRightDisabled}
          aria-label="Copy difference to right"
          title="Copy the difference under the caret / selection to the right side"
        >
          →
        </button>
      </div>
      <div className="awapi-textdiff__group" role="group" aria-label="View">
        <button
          type="button"
          className={`awapi-textdiff__btn${options.sideBySide ? '' : ' awapi-textdiff__btn--on'}`}
          aria-pressed={!options.sideBySide}
          onClick={() => onOptionsChange({ sideBySide: !options.sideBySide })}
          title="Show differences in a single inline pane"
        >
          Inline
        </button>
        <button
          type="button"
          className={`awapi-textdiff__btn${options.wordWrap ? ' awapi-textdiff__btn--on' : ''}`}
          aria-pressed={options.wordWrap}
          onClick={() => onOptionsChange({ wordWrap: !options.wordWrap })}
          title="Wrap long lines"
        >
          Wrap
        </button>
        <IgnorePopover
          options={options}
          onOptionsChange={onOptionsChange}
          onReset={onResetOptions}
        />
      </div>
      <div className="awapi-textdiff__status">{children}</div>
    </header>
  );
}

function IgnorePopover({
  options,
  onOptionsChange,
  onReset,
}: {
  options: TextCompareOptions;
  onOptionsChange(patch: Partial<TextCompareOptions>): void;
  onReset(): void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => options.ignorePatterns.join('\n'));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  // Pick up external changes (Reset) without clobbering text the user
  // is typing: only overwrite when the parsed draft no longer matches.
  const patternsKey = JSON.stringify(options.ignorePatterns);
  useEffect(() => {
    if (JSON.stringify(parsePatternText(draft)) !== patternsKey) {
      setDraft(options.ignorePatterns.join('\n'));
    }
    // `draft` is deliberately not a dependency: this only syncs from the store.
  }, [patternsKey]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const { errors } = compileIgnorePatterns(options.ignorePatterns);
  const activeCount =
    (options.ignoreAllWhitespace ? 1 : 0) +
    (options.ignoreCase ? 1 : 0) +
    (options.ignorePatterns.length > 0 ? 1 : 0) +
    (options.ignoreTrimWhitespace ? 1 : 0);

  return (
    <div className="awapi-textdiff__popover-host" ref={rootRef}>
      <button
        type="button"
        className={`awapi-textdiff__btn${activeCount > 0 ? ' awapi-textdiff__btn--on' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        title="Choose which differences to ignore"
      >
        Ignore{activeCount > 0 ? ` (${activeCount})` : ''} ▾
      </button>
      {open ? (
        <div
          id={panelId}
          className="awapi-textdiff__popover"
          role="dialog"
          aria-label="Ignore options"
        >
          <label className="awapi-textdiff__check">
            <input
              type="checkbox"
              checked={options.ignoreTrimWhitespace}
              onChange={(e) => onOptionsChange({ ignoreTrimWhitespace: e.target.checked })}
            />
            Leading / trailing whitespace
          </label>
          <label className="awapi-textdiff__check">
            <input
              type="checkbox"
              checked={options.ignoreAllWhitespace}
              onChange={(e) => onOptionsChange({ ignoreAllWhitespace: e.target.checked })}
            />
            All whitespace
          </label>
          <label className="awapi-textdiff__check">
            <input
              type="checkbox"
              checked={options.ignoreCase}
              onChange={(e) => onOptionsChange({ ignoreCase: e.target.checked })}
            />
            Letter case
          </label>
          <label className="awapi-textdiff__patterns">
            <span>Text matching (regular expressions, one per line)</span>
            <textarea
              rows={3}
              spellCheck={false}
              value={draft}
              placeholder={'\\d{4}-\\d{2}-\\d{2}\n//.*'}
              onChange={(e) => {
                setDraft(e.target.value);
                onOptionsChange({ ignorePatterns: parsePatternText(e.target.value) });
              }}
            />
          </label>
          {errors.length > 0 ? (
            <ul className="awapi-textdiff__pattern-errors" role="alert">
              {errors.map((er) => (
                <li key={er.pattern}>
                  <code>{er.pattern}</code>: {er.message}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="awapi-textdiff__hint">
            Ignored differences are dimmed and skipped by Next / Previous.
          </p>
          <button type="button" className="awapi-textdiff__btn" onClick={onReset}>
            Reset
          </button>
        </div>
      ) : null}
    </div>
  );
}
