import type { DiffOptions } from '@awapi/shared';

/**
 * Compute the *pairing key* for a relative path under the given match
 * policy. Two entries (one from each side) are paired iff they produce
 * the same pairing key.
 *
 * The transformations are applied in order so the output is stable and
 * deterministic:
 *
 * 1. Optional Unicode NFC normalisation — lets macOS-decomposed names
 *    pair with their NFC equivalents.
 * 2. Optional case folding — segments are lower-cased.
 * 3. Optional extension stripping — only the *file's own* extension
 *    (the trailing `.ext` of the basename) is removed; directory
 *    components keep their dots.
 *
 * Pure; no IO. Designed for hot-loop use during pairing — every cost is
 * proportional to the path length.
 */
export function pairingKey(relPath: string, options: DiffOptions['pairing']): string {
  let value = relPath;
  if (options.unicodeNormalize && typeof value.normalize === 'function') {
    value = value.normalize('NFC');
  }
  if (!options.caseSensitive) {
    value = value.toLowerCase();
  }
  if (options.ignoreExtension) {
    value = stripBasenameExtension(value);
  }
  return value;
}

function stripBasenameExtension(p: string): string {
  const slash = p.lastIndexOf('/');
  const base = slash >= 0 ? p.slice(slash + 1) : p;
  const dir = slash >= 0 ? p.slice(0, slash + 1) : '';
  // Skip dotfiles like `.env` (no extension to strip).
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return p;
  return dir + base.slice(0, dot);
}
