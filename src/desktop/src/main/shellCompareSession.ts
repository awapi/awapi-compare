import { promises as fsPromises } from 'node:fs';

export type ShellEntryKind = 'file' | 'folder' | 'other' | 'missing';
type StatFn = (path: string) => Promise<{ isFile(): boolean; isDirectory(): boolean }>;

/**
 * Resolve an on-disk path into a shell compare kind.
 */
export async function detectShellEntryKind(
  path: string,
  statFn: StatFn = fsPromises.stat,
): Promise<ShellEntryKind> {
  try {
    const stat = await statFn(path);
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'folder';
    return 'other';
  } catch {
    return 'missing';
  }
}

/**
 * Determine whether two selected paths can be compared in one tab.
 *
 * Returns the compare type when both are files or both are folders.
 * Returns `null` for mixed/unsupported/missing pairs.
 */
export async function resolveShellCompareType(
  leftPath: string,
  rightPath: string,
  statFn: StatFn = fsPromises.stat,
): Promise<'file' | 'folder' | null> {
  const [leftKind, rightKind] = await Promise.all([
    detectShellEntryKind(leftPath, statFn),
    detectShellEntryKind(rightPath, statFn),
  ]);

  if (leftKind === 'file' && rightKind === 'file') return 'file';
  if (leftKind === 'folder' && rightKind === 'folder') return 'folder';
  return null;
}
