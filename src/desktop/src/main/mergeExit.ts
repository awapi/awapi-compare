/** Identity of a file at a point in time; `null` when it does not exist. */
export interface FileStamp {
  mtimeMs: number;
  size: number;
}

/**
 * Process exit code for a `--type merge` launch (what `git mergetool`
 * checks with `trustExitCode`): `0` when the output file was written
 * while the window was open, `1` when the merge was abandoned.
 */
export function mergeExitCode(before: FileStamp | null, after: FileStamp | null): 0 | 1 {
  if (after === null) return 1;
  if (before === null) return 0;
  return before.mtimeMs !== after.mtimeMs || before.size !== after.size ? 0 : 1;
}
