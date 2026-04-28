/**
 * Renderer-side path helpers. The renderer cannot import Node's
 * `path` module (no Node integration), so we implement the small
 * subset we need here as pure string manipulation.
 *
 * These helpers operate on absolute filesystem paths and accept both
 * POSIX (`/foo/bar`) and Windows (`C:\foo\bar`, UNC `\\server\share`)
 * conventions. They are intentionally permissive about mixed
 * separators because users may paste paths from anywhere.
 */

const WIN_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const WIN_DRIVE_ONLY_RE = /^[a-zA-Z]:[\\/]?$/;
const UNC_ROOT_RE = /^\\\\[^\\/]+\\[^\\/]+\\?$/;

function isWindowsPath(p: string): boolean {
  return WIN_DRIVE_RE.test(p) || p.startsWith('\\\\');
}

/**
 * Returns the parent directory of an absolute path, or `null` when
 * `p` is already a filesystem root (or is empty / not a path we can
 * navigate up from).
 */
export function parentDir(p: string): string | null {
  if (!p) return null;
  const trimmed = p.trim();
  if (!trimmed) return null;

  if (isWindowsPath(trimmed)) {
    // Already at a drive root (`C:\`) or UNC root (`\\server\share` /
    // `\\server\share\`).
    if (WIN_DRIVE_ONLY_RE.test(trimmed) || UNC_ROOT_RE.test(trimmed)) {
      return null;
    }
    // Strip trailing separators so `C:\foo\` and `C:\foo` behave
    // identically.
    const s = trimmed.replace(/[\\/]+$/, '');
    if (WIN_DRIVE_ONLY_RE.test(`${s}\\`)) return null;
    if (UNC_ROOT_RE.test(`${s}\\`)) return null;
    const idx = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
    if (idx <= 0) return null;
    const head = s.slice(0, idx);
    // If chopping leaves us at a drive (`C:`) or UNC root, re-add
    // the trailing separator so the result is a valid root path.
    if (/^[a-zA-Z]:$/.test(head)) return `${head}\\`;
    if (/^\\\\[^\\/]+\\[^\\/]+$/.test(head)) return head;
    return head;
  }

  // POSIX
  if (trimmed === '/') return null;
  const s = trimmed.replace(/\/+$/, '');
  if (s === '' || s === '/') return null;
  const idx = s.lastIndexOf('/');
  if (idx < 0) return null;
  if (idx === 0) return '/';
  return s.slice(0, idx);
}
