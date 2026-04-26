/**
 * Tiny path helpers for the renderer. The renderer can't import
 * `node:path`, but every path we ever handle is either an absolute
 * filesystem path (from the main process) or a posix-style relPath
 * (produced by the scanner). A `${root}/${rel}` join with separator
 * normalisation is enough for our needs.
 */

/** Join an absolute root and a posix-style relative path. */
export function joinPath(root: string, relPath: string): string {
  if (!root) return relPath;
  if (!relPath) return root;
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const trimmedRoot = root.replace(/[\\/]+$/, '');
  const trimmedRel = relPath.replace(/^[\\/]+/, '').split(/[\\/]/).join(sep);
  return `${trimmedRoot}${sep}${trimmedRel}`;
}

/** Return everything after the final `/` or `\` separator. */
export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(i + 1) : path;
}

/** Return the extension including the leading dot, or `''` if none. */
export function extname(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}
