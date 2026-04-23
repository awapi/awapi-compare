import * as nodeFs from 'node:fs';

import type { FsEntry } from '@awapi/shared';

/**
 * Minimal filesystem surface the scanner needs. Matches the shape of both
 * `node:fs/promises` and memfs's `fs.promises` so tests can inject an
 * in-memory volume.
 */
export interface ScannerFs {
  promises: {
    readdir(
      path: string,
      options: { withFileTypes: true },
    ): Promise<Array<{ name: string; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }>>;
    lstat(path: string): Promise<{
      size: number;
      mtimeMs: number;
      mode: number;
      isFile(): boolean;
      isDirectory(): boolean;
      isSymbolicLink(): boolean;
    }>;
    realpath(path: string): Promise<string>;
  };
}

export interface ScannerOptions {
  /** Follow symlinks during traversal. Defaults to `false`. */
  followSymlinks?: boolean;
  /** Injectable fs; defaults to `node:fs`. */
  fs?: ScannerFs;
  /** Path join/normalisation. Defaults to `node:path.posix` semantics. */
  pathJoin?: (...parts: string[]) => string;
}

export type ScanItem =
  | { kind: 'entry'; entry: FsEntry }
  | { kind: 'error'; relPath: string; message: string };

/** Normalise any system-specific separators to POSIX `/` for relPaths. */
function toPosix(p: string): string {
  return p.split(/[\\/]/).join('/');
}

/**
 * Recursive async-generator folder walker. Yields one entry at a time so
 * callers can consume with backpressure (the generator pauses between
 * `yield`s). Errors on individual entries are surfaced as `ScanItem`s of
 * kind `'error'` rather than thrown, so a single unreadable file never
 * aborts the whole scan.
 *
 * - Uses `lstat` so symlinks are detected (not silently followed).
 * - Guards against symlink cycles via a `visited` set of real paths.
 */
export async function* scan(
  root: string,
  options: ScannerOptions = {},
): AsyncGenerator<ScanItem, void, void> {
  const fs = options.fs ?? (nodeFs as unknown as ScannerFs);
  const follow = options.followSymlinks === true;

  const rootReal = await safeRealpath(fs, root);
  const visited = new Set<string>();
  if (rootReal) visited.add(rootReal);

  yield* walk(fs, root, '', follow, visited);
}

async function* walk(
  fs: ScannerFs,
  absDir: string,
  relDir: string,
  follow: boolean,
  visited: Set<string>,
): AsyncGenerator<ScanItem, void, void> {
  let dirents: Awaited<ReturnType<ScannerFs['promises']['readdir']>>;
  try {
    dirents = await fs.promises.readdir(absDir, { withFileTypes: true });
  } catch (err) {
    yield { kind: 'error', relPath: relDir, message: errMessage(err) };
    return;
  }

  // Deterministic ordering helps tests and the UI.
  dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const d of dirents) {
    const absChild = joinPath(absDir, d.name);
    const relChild = relDir === '' ? d.name : `${relDir}/${d.name}`;

    let stat;
    try {
      stat = await fs.promises.lstat(absChild);
    } catch (err) {
      yield { kind: 'error', relPath: relChild, message: errMessage(err) };
      continue;
    }

    if (stat.isSymbolicLink()) {
      if (!follow) {
        yield {
          kind: 'entry',
          entry: {
            relPath: relChild,
            name: d.name,
            type: 'symlink',
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            mode: stat.mode,
          },
        };
        continue;
      }
      const target = await safeRealpath(fs, absChild);
      if (!target) {
        yield { kind: 'error', relPath: relChild, message: 'unreadable symlink target' };
        continue;
      }
      if (visited.has(target)) {
        yield { kind: 'error', relPath: relChild, message: 'symlink cycle skipped' };
        continue;
      }
      visited.add(target);
      // Re-stat through the symlink to pull the target's metadata.
      let tstat;
      try {
        tstat = await fs.promises.lstat(target);
      } catch (err) {
        yield { kind: 'error', relPath: relChild, message: errMessage(err) };
        continue;
      }
      if (tstat.isDirectory()) {
        yield {
          kind: 'entry',
          entry: {
            relPath: relChild,
            name: d.name,
            type: 'dir',
            size: 0,
            mtimeMs: tstat.mtimeMs,
            mode: tstat.mode,
          },
        };
        yield* walk(fs, target, relChild, follow, visited);
      } else if (tstat.isFile()) {
        yield {
          kind: 'entry',
          entry: {
            relPath: relChild,
            name: d.name,
            type: 'file',
            size: tstat.size,
            mtimeMs: tstat.mtimeMs,
            mode: tstat.mode,
          },
        };
      }
      continue;
    }

    if (stat.isDirectory()) {
      yield {
        kind: 'entry',
        entry: {
          relPath: relChild,
          name: d.name,
          type: 'dir',
          size: 0,
          mtimeMs: stat.mtimeMs,
          mode: stat.mode,
        },
      };
      yield* walk(fs, absChild, relChild, follow, visited);
      continue;
    }

    if (stat.isFile()) {
      yield {
        kind: 'entry',
        entry: {
          relPath: relChild,
          name: d.name,
          type: 'file',
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          mode: stat.mode,
        },
      };
    }
  }
}

async function safeRealpath(fs: ScannerFs, p: string): Promise<string | undefined> {
  try {
    return await fs.promises.realpath(p);
  } catch {
    return undefined;
  }
}

function joinPath(dir: string, name: string): string {
  if (dir.endsWith('/') || dir.endsWith('\\')) return dir + name;
  // memfs always uses `/`; node paths may use the platform separator. Using
  // `/` here works on both because node accepts forward slashes even on win32.
  return `${dir}/${name}`;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// Exported for the unlikely case a caller has an OS-native path and needs
// to normalise it for display.
export { toPosix };
