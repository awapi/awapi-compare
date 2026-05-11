import type { JSX } from 'react';

/**
 * Inline SVG icon set for AwapiCompare's chrome (toolbar, path bar,
 * diff tree). We deliberately avoid Unicode emoji glyphs (e.g. 🕐 💾
 * 📁) because their rendering depends on the host OS shipping a
 * matching emoji / symbol font:
 *
 *   - macOS:   Apple Color Emoji ✓
 *   - Windows: Segoe UI Emoji / Segoe UI Symbol ✓
 *   - Linux:   varies. Many minimal desktops (and several distros'
 *              default Electron sandbox) lack an emoji font, so the
 *              user sees tofu (□).
 *
 * Bundling an emoji font would add ~10 MB just for these icons. Inline
 * SVG keeps the install size flat (~3 KB total, all in the renderer
 * bundle), is crisp at every DPI, and inherits the surrounding
 * `color` via `currentColor` so theming "just works".
 *
 * All paths are 24x24 viewBox, stroke-based (Lucide-style) so they
 * stay legible at the 18 px size used in the toolbar without any
 * raster artifacts. Filled glyphs (Stop, Save) use `fill='currentColor'`
 * on the relevant elements only.
 */
export type IconName =
  | 'clock'
  | 'asterisk'
  | 'not-equal'
  | 'equal'
  | 'refresh'
  | 'swap'
  | 'stop'
  | 'save'
  | 'scale'
  | 'settings'
  | 'sun'
  | 'moon'
  | 'folder'
  | 'file'
  | 'arrow-up'
  | 'chevron-down'
  | 'chevron-right';

export interface IconProps {
  name: IconName;
  /** Pixel size of the rendered SVG (width = height). Defaults to 18. */
  size?: number;
  /** Optional class name forwarded to the root <svg>. */
  className?: string;
}

const STROKE = 2;

/**
 * Body of each icon as raw SVG markup. Keeping these as plain JSX
 * fragments (rather than building paths in JS) makes the icons trivial
 * to tweak and lets the bundler tree-shake unused props. The
 * surrounding `<svg>` is shared so every icon ends up the same size,
 * weight and color.
 */
function renderBody(name: IconName): JSX.Element {
  switch (name) {
    case 'clock':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 14" />
        </>
      );
    case 'asterisk':
      // Six-pointed asterisk — used for "All" filter.
      return (
        <>
          <line x1="12" y1="4" x2="12" y2="20" />
          <line x1="5" y1="8" x2="19" y2="16" />
          <line x1="5" y1="16" x2="19" y2="8" />
        </>
      );
    case 'not-equal':
      return (
        <>
          <line x1="5" y1="9" x2="19" y2="9" />
          <line x1="5" y1="15" x2="19" y2="15" />
          <line x1="17" y1="5" x2="7" y2="19" />
        </>
      );
    case 'equal':
      return (
        <>
          <line x1="5" y1="9" x2="19" y2="9" />
          <line x1="5" y1="15" x2="19" y2="15" />
        </>
      );
    case 'refresh':
      // Circular arrow (Lucide "rotate-cw").
      return (
        <>
          <polyline points="21 4 21 10 15 10" />
          <path d="M20.49 15a9 9 0 1 1-2.13-9.36L21 10" />
        </>
      );
    case 'swap':
      // Two arrows pointing in opposite directions on the same axis.
      return (
        <>
          <polyline points="7 4 3 8 7 12" />
          <line x1="3" y1="8" x2="21" y2="8" />
          <polyline points="17 20 21 16 17 12" />
          <line x1="21" y1="16" x2="3" y2="16" />
        </>
      );
    case 'stop':
      return <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />;
    case 'save':
      // Floppy-disk silhouette.
      return (
        <>
          <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
          <polyline points="7 4 7 9 15 9 15 4" />
          <rect x="8" y="13" width="8" height="6" />
        </>
      );
    case 'scale':
      // Balance scale — used for "Match" / diff options.
      return (
        <>
          <line x1="12" y1="4" x2="12" y2="20" />
          <line x1="6" y1="20" x2="18" y2="20" />
          <path d="M4 11l3-6 3 6" />
          <path d="M14 11l3-6 3 6" />
          <path d="M4 11a3 3 0 0 0 6 0" />
          <path d="M14 11a3 3 0 0 0 6 0" />
        </>
      );
    case 'settings':
      // Gear (8 teeth, simplified).
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
        </>
      );
    case 'sun':
      return (
        <>
          <circle cx="12" cy="12" r="4" />
          <line x1="12" y1="2" x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="2" y1="12" x2="5" y2="12" />
          <line x1="19" y1="12" x2="22" y2="12" />
          <line x1="4.9" y1="4.9" x2="7" y2="7" />
          <line x1="17" y1="17" x2="19.1" y2="19.1" />
          <line x1="4.9" y1="19.1" x2="7" y2="17" />
          <line x1="17" y1="7" x2="19.1" y2="4.9" />
        </>
      );
    case 'moon':
      return <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />;
    case 'folder':
      return (
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      );
    case 'file':
      return (
        <>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <polyline points="14 3 14 8 19 8" />
        </>
      );
    case 'arrow-up':
      return (
        <>
          <line x1="12" y1="5" x2="12" y2="19" />
          <polyline points="6 11 12 5 18 11" />
        </>
      );
    case 'chevron-down':
      return <polyline points="6 9 12 15 18 9" />;
    case 'chevron-right':
      return <polyline points="9 6 15 12 9 18" />;
  }
}

export function Icon({ name, size = 18, className }: IconProps): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {renderBody(name)}
    </svg>
  );
}
