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
  onCompare(): void;
  onRefresh(): void;
  onToggleTheme(): void;
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
    onCompare,
    onRefresh,
    onToggleTheme,
  } = props;

  const canCompare = !scanning && leftRoot.trim() !== '' && rightRoot.trim() !== '';

  return (
    <>
      <header
        className="awapi-toolbar"
        role="toolbar"
        aria-label="Compare toolbar"
      >
        <div className="awapi-toolbar__group">
          <IconBtn glyph="⌂" label="Home" />
          <IconBtn glyph="🗂" label="Sessions" />
        </div>
        <div className="awapi-toolbar__group">
          <IconBtn glyph="✱" label="All" />
          <IconBtn glyph="≠" label="Diffs" active />
          <IconBtn glyph="=" label="Same" />
        </div>
        <div className="awapi-toolbar__group">
          <IconBtn glyph="📄" label="Files" />
          <IconBtn
            glyph="▶"
            label={scanning ? 'Scanning…' : 'Compare'}
            ariaLabel={scanning ? 'Scanning' : 'Compare'}
            disabled={!canCompare}
            onClick={onCompare}
          />
          <IconBtn
            glyph="↻"
            label="Refresh"
            disabled={scanning}
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
            glyph={theme === 'dark' ? '☀' : '☾'}
            label={theme === 'dark' ? 'Light' : 'Dark'}
            ariaLabel="Toggle theme"
            onClick={onToggleTheme}
          />
        </div>
      </header>
      <div className="awapi-pathbar" role="group" aria-label="Folder paths">
        <div className="awapi-pathbar__side">
          <input
            type="text"
            placeholder="Left folder…"
            aria-label="Left folder"
            value={leftRoot}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onLeftRootChange(e.target.value)
            }
          />
        </div>
        <div className="awapi-pathbar__side">
          <input
            type="text"
            placeholder="Right folder…"
            aria-label="Right folder"
            value={rightRoot}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onRightRootChange(e.target.value)
            }
          />
        </div>
      </div>
    </>
  );
}
