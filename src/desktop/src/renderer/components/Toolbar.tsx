import type { ChangeEvent, JSX, ReactNode } from 'react';
import type { CompareMode } from '@awapi/shared';
import type { ThemeName } from '../state/themeStore.js';

export interface ToolbarProps {
  leftRoot: string;
  rightRoot: string;
  mode: CompareMode;
  scanning: boolean;
  theme: ThemeName;
  onLeftRootChange(value: string): void;
  onRightRootChange(value: string): void;
  onModeChange(mode: CompareMode): void;
  onRefresh(): void;
  onToggleTheme(): void;
  onOpenRules(): void;
  onPickLeftFolder?(): void;
  onPickRightFolder?(): void;
  onOpenDiffOptions?(): void;
  /**
   * Whether the path inputs represent folder roots (default) or
   * single file paths. Only affects placeholder, aria-label and
   * browse-button titles — the actual path values are still passed
   * through `leftRoot`/`rightRoot`.
   */
  pathLabel?: 'folder' | 'file';
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
    onOpenDiffOptions,
    pathLabel = 'folder',
  } = props;

  const canCompare = !scanning && leftRoot.trim() !== '' && rightRoot.trim() !== '';
  const leftLabel = pathLabel === 'file' ? 'Left file' : 'Left folder';
  const rightLabel = pathLabel === 'file' ? 'Right file' : 'Right folder';
  const leftPlaceholder = pathLabel === 'file' ? 'Left file\u2026' : 'Left folder\u2026';
  const rightPlaceholder = pathLabel === 'file' ? 'Right file\u2026' : 'Right folder\u2026';
  const browseTitle = pathLabel === 'file' ? 'Browse for file' : 'Browse for folder';

  return (
    <>
      <header
        className="awapi-toolbar"
        role="toolbar"
        aria-label="Compare toolbar"
      >
        <div className="awapi-toolbar__group">
          <IconBtn glyph="⌂" label="Home" disabled title="Coming soon" />
          <IconBtn glyph="🗂" label="Sessions" disabled title="Coming soon" />
        </div>
        <div className="awapi-toolbar__group">
          <IconBtn glyph="✱" label="All" disabled title="Coming soon" />
          <IconBtn glyph="≠" label="Diffs" active disabled title="Coming soon" />
          <IconBtn glyph="=" label="Same" disabled title="Coming soon" />
        </div>
        <div className="awapi-toolbar__group">
          <IconBtn glyph="📄" label="Files" disabled title="Coming soon" />
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
          <input
            type="text"
            placeholder={leftPlaceholder}
            aria-label={leftLabel}
            value={leftRoot}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onLeftRootChange(e.target.value)
            }
          />
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
          <input
            type="text"
            placeholder={rightPlaceholder}
            aria-label={rightLabel}
            value={rightRoot}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onRightRootChange(e.target.value)
            }
          />
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
