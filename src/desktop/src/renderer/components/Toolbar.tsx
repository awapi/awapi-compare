import { useId } from 'react';
import type { ChangeEvent, FormEvent, JSX, KeyboardEvent, ReactNode } from 'react';
import type { CompareMode } from '@awapi/shared';
import type { ThemeName } from '../state/themeStore.js';
import type { ViewFilter } from '../viewFilter.js';

export interface ToolbarProps {
  leftRoot: string;
  rightRoot: string;
  mode: CompareMode;
  scanning: boolean;
  theme: ThemeName;
  /** Current view filter (`'all' | 'diffs' | 'same'`). Defaults to `'all'`. */
  viewFilter?: ViewFilter;
  onLeftRootChange(value: string): void;
  onRightRootChange(value: string): void;
  onModeChange(mode: CompareMode): void;
  onRefresh(): void;
  onToggleTheme(): void;
  onOpenRules(): void;
  onPickLeftFolder?(): void;
  onPickRightFolder?(): void;
  /**
   * Called when the user clicks the "folder up" button next to the
   * left / right path input. Implementations should resolve the
   * parent directory of the current value and update the path. The
   * button is hidden when no handler is provided.
   */
  onGoUpLeft?(): void;
  onGoUpRight?(): void;
  onOpenDiffOptions?(): void;
  onViewFilterChange?(filter: ViewFilter): void;
  /**
   * Called when the user presses Enter while focused in either path
   * input. Used to load/refresh the comparison immediately instead of
   * waiting for the debounced auto-compare. Defaults to `onRefresh`
   * when omitted.
   */
  onSubmitPaths?(): void;
  /**
   * Whether the path inputs represent folder roots (default) or
   * single file paths. Only affects placeholder, aria-label and
   * browse-button titles — the actual path values are still passed
   * through `leftRoot`/`rightRoot`.
   */
  pathLabel?: 'folder' | 'file';
  /**
   * Whether to show the compare-mode (`Quick / Thorough / Binary`)
   * dropdown. Defaults to `true`. The mode only matters for folder
   * scans; file-content tabs hide it because the text/hex/image
   * diffs always read both files in full.
   */
  showMode?: boolean;
  /**
   * Optional save handlers for editable text-diff sides. When
   * provided, the toolbar renders a `Save left` / `Save right` icon
   * button next to Refresh/Swap/Stop, enabled only when the
   * corresponding side is editable, dirty, and no save is in flight.
   */
  onSaveLeft?: () => void;
  onSaveRight?: () => void;
  leftEditable?: boolean;
  rightEditable?: boolean;
  leftDirty?: boolean;
  rightDirty?: boolean;
  /** Side currently being saved, or `null` when idle. */
  saving?: 'left' | 'right' | null;
  /**
   * Optional list of recent values to surface in the left / right
   * path inputs as a native dropdown (HTML `<datalist>`). The list is
   * read-only from the toolbar's perspective; ordering is preserved
   * (newest first). When omitted, the input renders as a plain text
   * field (no dropdown chrome).
   */
  leftRecents?: readonly string[];
  rightRecents?: readonly string[];
}

const MODES: ReadonlyArray<{ value: CompareMode; label: string }> = [
  { value: 'quick', label: 'Quick (size + mtime)' },
  { value: 'thorough', label: 'Thorough (SHA-256)' },
  { value: 'binary', label: 'Binary (byte-by-byte)' },
];

interface IconBtnProps {
  glyph: string;
  label: string;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}

function IconBtn({
  glyph,
  label,
  title,
  ariaLabel,
  disabled,
  active,
  onClick,
  children,
}: IconBtnProps): JSX.Element {
  return (
    <button
      type="button"
      className={`awapi-iconbtn${active ? ' awapi-iconbtn--active' : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
      aria-label={ariaLabel ?? label}
    >
      <span className="awapi-iconbtn__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span>{children ?? label}</span>
    </button>
  );
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  const {
    leftRoot,
    rightRoot,
    mode,
    scanning,
    theme,
    onLeftRootChange,
    onRightRootChange,
    onModeChange,
    onRefresh,
    onToggleTheme,
    onOpenRules,
    onPickLeftFolder,
    onPickRightFolder,
    onGoUpLeft,
    onGoUpRight,
    onOpenDiffOptions,
    onViewFilterChange,
    onSubmitPaths,
    viewFilter = 'all',
    pathLabel = 'folder',
    showMode = true,
    onSaveLeft,
    onSaveRight,
    leftEditable = false,
    rightEditable = false,
    leftDirty = false,
    rightDirty = false,
    saving = null,
    leftRecents,
    rightRecents,
  } = props;

  // Stable per-input ids so the <datalist> can be wired up via the
  // input's `list` attribute without colliding when multiple toolbars
  // are mounted (e.g. several compare tabs).
  const reactId = useId();
  const leftListId = `awapi-recents-left-${reactId}`;
  const rightListId = `awapi-recents-right-${reactId}`;

  const canCompare = !scanning && (leftRoot.trim() !== '' || rightRoot.trim() !== '');
  const leftLabel = pathLabel === 'file' ? 'Left file' : 'Left folder';
  const rightLabel = pathLabel === 'file' ? 'Right file' : 'Right folder';
  const leftPlaceholder = pathLabel === 'file' ? 'Left file\u2026' : 'Left folder\u2026';
  const rightPlaceholder = pathLabel === 'file' ? 'Right file\u2026' : 'Right folder\u2026';
  const browseTitle = pathLabel === 'file' ? 'Browse for file' : 'Browse for folder';
  const upTitle = 'Go to parent folder';

  const handlePathKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    (onSubmitPaths ?? onRefresh)();
  };

  // Picking a value from a `<datalist>` fires an `input` event whose
  // `inputType` is `insertReplacementText` in Chromium. When that
  // happens we treat it as a commit so the user doesn't also need to
  // press Enter to load the chosen folder / file. The standard
  // `onChange` handler still owns the actual value update.
  const handlePathInput = (e: FormEvent<HTMLInputElement>): void => {
    const native = e.nativeEvent as InputEvent;
    if (native.inputType === 'insertReplacementText') {
      (onSubmitPaths ?? onRefresh)();
    }
  };

  return (
    <>
      <header
        className="awapi-toolbar"
        role="toolbar"
        aria-label="Compare toolbar"
      >
        <div className="awapi-toolbar__group" role="group" aria-label="View filter">
          <IconBtn
            glyph="✱"
            label="All"
            ariaLabel="Show all entries"
            active={viewFilter === 'all'}
            disabled={!onViewFilterChange}
            onClick={() => onViewFilterChange?.('all')}
          />
          <IconBtn
            glyph="≠"
            label="Diffs"
            ariaLabel="Show only differences"
            active={viewFilter === 'diffs'}
            disabled={!onViewFilterChange}
            onClick={() => onViewFilterChange?.('diffs')}
          />
          <IconBtn
            glyph="="
            label="Same"
            ariaLabel="Show only matching entries"
            active={viewFilter === 'same'}
            disabled={!onViewFilterChange}
            onClick={() => onViewFilterChange?.('same')}
          />
        </div>
        <div className="awapi-toolbar__group">
          <IconBtn
            glyph="↻"
            label={scanning ? 'Scanning…' : 'Refresh'}
            ariaLabel={scanning ? 'Scanning' : 'Refresh'}
            disabled={!canCompare}
            onClick={onRefresh}
          />
          <IconBtn
            glyph="⇄"
            label="Swap"
            onClick={() => {
              onLeftRootChange(rightRoot);
              onRightRootChange(leftRoot);
            }}
          />
          <IconBtn glyph="■" label="Stop" disabled={!scanning} />
        </div>
        {onSaveLeft || onSaveRight ? (
          <div className="awapi-toolbar__group" role="group" aria-label="Save edits">
            {onSaveLeft ? (
              <IconBtn
                glyph="💾"
                label={saving === 'left' ? 'Saving…' : 'Save left'}
                ariaLabel="Save left"
                disabled={!leftEditable || !leftDirty || saving !== null}
                onClick={onSaveLeft}
              />
            ) : null}
            {onSaveRight ? (
              <IconBtn
                glyph="💾"
                label={saving === 'right' ? 'Saving…' : 'Save right'}
                ariaLabel="Save right"
                disabled={!rightEditable || !rightDirty || saving !== null}
                onClick={onSaveRight}
              />
            ) : null}
          </div>
        ) : null}
        {showMode ? (
          <div className="awapi-toolbar__group">
            <select
              aria-label="Compare mode"
              value={mode}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                onModeChange(e.target.value as CompareMode)
              }
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="awapi-toolbar__spacer" />
        <div className="awapi-toolbar__group">
          <IconBtn
            glyph="⚖"
            label="Match"
            ariaLabel="Open diff options"
            disabled={!onOpenDiffOptions}
            onClick={onOpenDiffOptions}
          />
          <IconBtn
            glyph="⚙"
            label="Rules"
            ariaLabel="Open rules editor"
            onClick={onOpenRules}
          />
        </div>
        <div className="awapi-toolbar__group">
          <IconBtn
            glyph={theme === 'dark' ? '☀' : '☾'}
            label={theme === 'dark' ? 'Light' : 'Dark'}
            ariaLabel="Toggle theme"
            onClick={onToggleTheme}
          />
        </div>
      </header>
      <div className="awapi-pathbar" role="group" aria-label={pathLabel === 'file' ? 'File paths' : 'Folder paths'}>
        <div className="awapi-pathbar__side">
          {onGoUpLeft ? (
            <button
              type="button"
              className="awapi-pathbar__pick"
              aria-label={`Go up from ${leftLabel.toLowerCase()}`}
              title={upTitle}
              disabled={!leftRoot.trim()}
              onClick={onGoUpLeft}
            >
              <span aria-hidden="true">↑</span>
            </button>
          ) : null}
          <input
            type="text"
            placeholder={leftPlaceholder}
            aria-label={leftLabel}
            value={leftRoot}
            list={leftRecents && leftRecents.length > 0 ? leftListId : undefined}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onLeftRootChange(e.target.value)
            }
            onInput={handlePathInput}
            onKeyDown={handlePathKeyDown}
          />
          {leftRecents && leftRecents.length > 0 ? (
            <datalist id={leftListId}>
              {leftRecents.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          ) : null}
          <button
            type="button"
            className="awapi-pathbar__pick"
            aria-label={`Browse for ${leftLabel.toLowerCase()}`}
            title={browseTitle}
            disabled={!onPickLeftFolder}
            onClick={onPickLeftFolder}
          >
            <span aria-hidden="true">📁</span>
          </button>
        </div>
        <div className="awapi-pathbar__side">
          {onGoUpRight ? (
            <button
              type="button"
              className="awapi-pathbar__pick"
              aria-label={`Go up from ${rightLabel.toLowerCase()}`}
              title={upTitle}
              disabled={!rightRoot.trim()}
              onClick={onGoUpRight}
            >
              <span aria-hidden="true">↑</span>
            </button>
          ) : null}
          <input
            type="text"
            placeholder={rightPlaceholder}
            aria-label={rightLabel}
            value={rightRoot}
            list={rightRecents && rightRecents.length > 0 ? rightListId : undefined}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onRightRootChange(e.target.value)
            }
            onInput={handlePathInput}
            onKeyDown={handlePathKeyDown}
          />
          {rightRecents && rightRecents.length > 0 ? (
            <datalist id={rightListId}>
              {rightRecents.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          ) : null}
          <button
            type="button"
            className="awapi-pathbar__pick"
            aria-label={`Browse for ${rightLabel.toLowerCase()}`}
            title={browseTitle}
            disabled={!onPickRightFolder}
            onClick={onPickRightFolder}
          >
            <span aria-hidden="true">📁</span>
          </button>
        </div>
      </div>
    </>
  );
}
