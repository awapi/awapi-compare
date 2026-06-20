import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import type { CompareMode, InitialCompareSession } from '@awapi/shared';

/**
 * Supported launch flags. Mirrors what the eventual standalone
 * `awapi-compare` CLI accepts; the desktop main process parses the
 * same shape so `just dev -- --left ... --right ...` (or env vars)
 * pre-populates the first compare tab.
 *
 * Usage:
 *
 *   awapi-compare --type folder --left ./a --right ./b [--mode quick|thorough|binary]
 *   awapi-compare --register-shell           # register Windows Explorer context menu
 *   awapi-compare --unregister-shell         # remove Windows Explorer context menu
 *
 * Environment variables (handy for `just dev`):
 *
 *   AWAPI_LEFT, AWAPI_RIGHT, AWAPI_TYPE, AWAPI_MODE
 *
 * Returns `null` when no recognised flag or env var is set. Throws on
 * malformed input. Unknown flags are ignored — Electron and
 * `electron-vite` inject their own (e.g. `--remote-debugging-port`)
 * which we must not reject.
 */
export interface ParseDesktopArgsOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** File-system stat for auto-detecting file-vs-directory (test seam). */
  stat?: (path: string) => { isDirectory(): boolean; isFile(): boolean };
}

/** Discriminated union of all recognised CLI actions. */
export type DesktopArgs =
  | { kind: 'compare'; session: InitialCompareSession }
  | { kind: 'openLeft'; path: string }
  | { kind: 'setLeft'; path: string }
  | { kind: 'comparePending'; rightPath: string }
  | { kind: 'compareTwo'; leftPath: string; rightPath: string }
  | { kind: 'compareAdd'; path: string }
  | { kind: 'registerShell' }
  | { kind: 'unregisterShell' }
  | null;

const MODES: ReadonlySet<CompareMode> = new Set(['quick', 'thorough', 'binary']);

export function parseDesktopArgs(
  argv: readonly string[],
  options: ParseDesktopArgsOptions = {},
): DesktopArgs {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;

  let left: string | undefined;
  let right: string | undefined;
  let mode: CompareMode | undefined;
  let explicitType: 'folder' | 'file' | undefined;
  let typeSeen = false;
  let registerShell = false;
  let unregisterShell = false;
  let setLeftPath: string | undefined;
  let comparePendingPath: string | undefined;
  let compareTwoLeft: string | undefined;
  let compareTwoRight: string | undefined;
  let compareAddPath: string | undefined;

  const requireValue = (raw: string | undefined, flag: string): string => {
    if (raw === undefined || raw.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return raw;
  };

  const assertType = (v: string): 'folder' | 'file' => {
    if (v !== 'folder' && v !== 'file') {
      throw new Error(`--type must be 'folder' or 'file' (got '${v}')`);
    }
    return v;
  };

  const assertMode = (v: string): CompareMode => {
    if (!MODES.has(v as CompareMode)) {
      throw new Error(`--mode must be one of: ${[...MODES].join(', ')}`);
    }
    return v as CompareMode;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--type') {
      explicitType = assertType(requireValue(argv[++i], '--type'));
      typeSeen = true;
    } else if (arg?.startsWith('--type=')) {
      explicitType = assertType(arg.slice('--type='.length));
      typeSeen = true;
    } else if (arg === '--left') {
      left = requireValue(argv[++i], '--left');
    } else if (arg?.startsWith('--left=')) {
      left = arg.slice('--left='.length);
    } else if (arg === '--right') {
      right = requireValue(argv[++i], '--right');
    } else if (arg?.startsWith('--right=')) {
      right = arg.slice('--right='.length);
    } else if (arg === '--mode') {
      mode = assertMode(requireValue(argv[++i], '--mode'));
    } else if (arg?.startsWith('--mode=')) {
      mode = assertMode(arg.slice('--mode='.length));
    } else if (arg === '--register-shell') {
      registerShell = true;
    } else if (arg === '--unregister-shell') {
      unregisterShell = true;
    } else if (arg === '--set-left') {
      setLeftPath = requireValue(argv[++i], '--set-left');
    } else if (arg?.startsWith('--set-left=')) {
      setLeftPath = arg.slice('--set-left='.length);
    } else if (arg === '--compare-pending') {
      comparePendingPath = requireValue(argv[++i], '--compare-pending');
    } else if (arg?.startsWith('--compare-pending=')) {
      comparePendingPath = arg.slice('--compare-pending='.length);
    } else if (arg === '--compare-two') {
      compareTwoLeft = requireValue(argv[++i], '--compare-two');
      compareTwoRight = requireValue(argv[++i], '--compare-two');
    } else if (arg?.startsWith('--compare-two=')) {
      const parts = arg.slice('--compare-two='.length).split(',');
      if (parts.length < 2) {
        throw new Error('--compare-two requires two paths separated by comma');
      }
      compareTwoLeft = parts[0];
      compareTwoRight = parts[1];
    } else if (arg === '--compare-add') {
      compareAddPath = requireValue(argv[++i], '--compare-add');
    } else if (arg?.startsWith('--compare-add=')) {
      compareAddPath = arg.slice('--compare-add='.length);
    }
    // anything else is ignored (Electron internal flags, etc.)
  }

  // Shell management actions take priority over everything else.
  if (registerShell) return { kind: 'registerShell' };
  if (unregisterShell) return { kind: 'unregisterShell' };

  // Shell-workflow verbs — must come before --left/--right fallback
  // so Explorer-invoked `--set-left <path>` doesn't get mistaken for
  // a single-sided folder open.
  if (setLeftPath !== undefined) {
    return {
      kind: 'setLeft',
      path: isAbsolute(setLeftPath) ? setLeftPath : resolve(cwd, setLeftPath),
    };
  }
  if (comparePendingPath !== undefined) {
    return {
      kind: 'comparePending',
      rightPath: isAbsolute(comparePendingPath)
        ? comparePendingPath
        : resolve(cwd, comparePendingPath),
    };
  }
  if (compareTwoLeft !== undefined && compareTwoRight !== undefined) {
    return {
      kind: 'compareTwo',
      leftPath: isAbsolute(compareTwoLeft) ? compareTwoLeft : resolve(cwd, compareTwoLeft),
      rightPath: isAbsolute(compareTwoRight) ? compareTwoRight : resolve(cwd, compareTwoRight),
    };
  }
  if (compareAddPath !== undefined) {
    return {
      kind: 'compareAdd',
      path: isAbsolute(compareAddPath) ? compareAddPath : resolve(cwd, compareAddPath),
    };
  }

  // Normal compare session via --left / --right (or env-var fallbacks).
  if (left === undefined) {
    const v = env['AWAPI_LEFT'];
    if (v && v.length > 0) left = v;
  }
  if (right === undefined) {
    const v = env['AWAPI_RIGHT'];
    if (v && v.length > 0) right = v;
  }
  if (mode === undefined) {
    const v = env['AWAPI_MODE'];
    if (v && v.length > 0) mode = assertMode(v);
  }
  if (!typeSeen) {
    const v = env['AWAPI_TYPE'];
    if (v && v.length > 0) {
      explicitType = assertType(v);
      typeSeen = true;
    }
  }

  if (left === undefined && right === undefined) return null;
  if (left === undefined) {
    throw new Error('--right requires --left to also be provided');
  }

  const resolvedLeft = isAbsolute(left) ? left : resolve(cwd, left);

  // Auto-detect folder vs file when --type was omitted.
  let detectedType: 'folder' | 'file' | null = null;
  const statImpl = options.stat ?? statSync;
  try {
    const st = statImpl(resolvedLeft);
    if (st.isDirectory()) detectedType = 'folder';
    else if (st.isFile()) detectedType = 'file';
  } catch {
    // path may not exist yet — fall through to heuristic
  }

  if (!typeSeen && detectedType) {
    typeSeen = true;
  }

  if (!typeSeen) {
    // heuristic: bare basename (no dot extension) → folder,
    // basename with extension → file.
    const base = resolvedLeft.split('/').pop() ?? resolvedLeft;
    if (base.includes('.') && !base.startsWith('.')) {
      detectedType = 'file';
    } else {
      detectedType = 'folder';
    }
    typeSeen = true;
  }

  const sessionType = explicitType ?? detectedType ?? 'folder';

  // --left without --right: open the app with only the left side populated.
  if (right === undefined) {
    return { kind: 'openLeft', path: resolvedLeft };
  }

  const resolvedRight = isAbsolute(right) ? right : resolve(cwd, right);

  return {
    kind: 'compare',
    session: {
      type: sessionType,
      leftRoot: resolvedLeft,
      rightRoot: resolvedRight,
      mode: mode ?? 'quick',
    },
  };
}
