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
 *   awapi-compare [--base ./base] --left ./ours --right ./theirs --output ./merged   # three-way merge
 *                 (`--type merge` is accepted too; --output alone selects a merge)
 *   awapi-compare --register-shell           # register Windows Explorer context menu
 *   awapi-compare --unregister-shell         # remove Windows Explorer context menu
 *
 * Environment variables (handy for `just dev`):
 *
 *   AWAPI_LEFT, AWAPI_RIGHT, AWAPI_TYPE, AWAPI_MODE, AWAPI_BASE, AWAPI_OUTPUT
 *
 * Returns `null` when no recognised flag or env var is set. Throws on
 * malformed input. Unknown flags are ignored — Electron and
 * `electron-vite` inject their own (e.g. `--remote-debugging-port`)
 * which we must not reject.
 */
export interface ParseDesktopArgsOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/** Discriminated union of all recognised CLI actions. */
export type DesktopArgs =
  | { kind: 'compare'; session: InitialCompareSession }
  | { kind: 'openLeft'; path: string }
  | { kind: 'registerShell' }
  | { kind: 'unregisterShell' }
  | { kind: 'setLeft'; path: string }
  | { kind: 'comparePending'; path: string }
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
  let type: 'folder' | 'file' | 'merge' | undefined;
  let base: string | undefined;
  let output: string | undefined;
  let typeSeen = false;
  let registerShell = false;
  let unregisterShell = false;
  let setLeftPath: string | undefined;
  let comparePendingPath: string | undefined;
  const positionalPaths: string[] = [];

  const requireValue = (raw: string | undefined, flag: string): string => {
    if (raw === undefined || raw.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return raw;
  };

  const assertType = (v: string): 'folder' | 'file' | 'merge' => {
    if (v !== 'folder' && v !== 'file' && v !== 'merge') {
      throw new Error(`--type must be 'folder', 'file' or 'merge' (got '${v}')`);
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
      type = assertType(requireValue(argv[++i], '--type'));
      typeSeen = true;
    } else if (arg?.startsWith('--type=')) {
      type = assertType(arg.slice('--type='.length));
      typeSeen = true;
    } else if (arg === '--left') {
      left = requireValue(argv[++i], '--left');
    } else if (arg?.startsWith('--left=')) {
      left = arg.slice('--left='.length);
    } else if (arg === '--right') {
      right = requireValue(argv[++i], '--right');
    } else if (arg?.startsWith('--right=')) {
      right = arg.slice('--right='.length);
    } else if (arg === '--base') {
      base = requireValue(argv[++i], '--base');
    } else if (arg?.startsWith('--base=')) {
      base = arg.slice('--base='.length);
    } else if (arg === '--output') {
      output = requireValue(argv[++i], '--output');
    } else if (arg?.startsWith('--output=')) {
      output = arg.slice('--output='.length);
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
    } else if (arg && !arg.startsWith('-')) {
      // Bare positional argument — e.g. paths passed by Windows "Send to".
      positionalPaths.push(arg);
    }
    // anything else (unknown --flags, Electron internals) is ignored.
  }

  // Shell management actions take priority over everything else.
  if (registerShell) return { kind: 'registerShell' };
  if (unregisterShell) return { kind: 'unregisterShell' };

  // Context-menu shell actions.
  if (setLeftPath !== undefined) {
    const resolved = isAbsolute(setLeftPath) ? setLeftPath : resolve(cwd, setLeftPath);
    return { kind: 'setLeft', path: resolved };
  }
  if (comparePendingPath !== undefined) {
    const resolved = isAbsolute(comparePendingPath) ? comparePendingPath : resolve(cwd, comparePendingPath);
    return { kind: 'comparePending', path: resolved };
  }

  // Env-var fallbacks for --left / --right (applied before positional-path check).
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
    if (v && v.length > 0) type = assertType(v);
  }
  if (base === undefined) {
    const v = env['AWAPI_BASE'];
    if (v && v.length > 0) base = v;
  }
  if (output === undefined) {
    const v = env['AWAPI_OUTPUT'];
    if (v && v.length > 0) output = v;
  }

  const abs = (p: string): string => (isAbsolute(p) ? p : resolve(cwd, p));

  // Three-way merge (`git mergetool`): needs both sides and an output file.
  // `--output` alone selects it, because Chromium reserves `--type=` and
  // misbehaves when it is given on the Electron command line.
  if (type === 'merge' || output !== undefined) {
    if (left === undefined || right === undefined) {
      throw new Error('a merge requires both --left and --right');
    }
    if (output === undefined) {
      throw new Error('--type merge requires --output');
    }
    return {
      kind: 'compare',
      session: {
        type: 'merge',
        ...(base !== undefined ? { basePath: abs(base) } : {}),
        leftPath: abs(left),
        rightPath: abs(right),
        outputPath: abs(output),
      },
    };
  }

  // Two bare positional paths (e.g. Windows "Send to" with 2 items selected):
  // treat as a direct left↔right compare. Only applies when --left/--right
  // (and their env-var equivalents) are absent.
  if (positionalPaths.length === 2 && left === undefined && right === undefined) {
    const [rawL, rawR] = positionalPaths as [string, string];
    const resolvedL = isAbsolute(rawL) ? rawL : resolve(cwd, rawL);
    const resolvedR = isAbsolute(rawR) ? rawR : resolve(cwd, rawR);
    if (type === 'file') {
      return {
        kind: 'compare',
        session: { type: 'file', leftPath: resolvedL, rightPath: resolvedR },
      };
    }
    return {
      kind: 'compare',
      session: {
        type: 'folder',
        leftRoot: resolvedL,
        rightRoot: resolvedR,
        mode: mode ?? 'quick',
      },
    };
  }

  if (left === undefined && right === undefined) return null;
  if (left === undefined) {
    throw new Error('--right requires --left to also be provided');
  }

  const resolvedLeft = isAbsolute(left) ? left : resolve(cwd, left);

  // --left without --right: open the app with only the left side populated.
  if (right === undefined) {
    return { kind: 'openLeft', path: resolvedLeft };
  }

  const resolvedRight = isAbsolute(right) ? right : resolve(cwd, right);

  if (type === 'file') {
    return {
      kind: 'compare',
      session: { type: 'file', leftPath: resolvedLeft, rightPath: resolvedRight },
    };
  }

  return {
    kind: 'compare',
    session: {
      type: 'folder',
      leftRoot: resolvedLeft,
      rightRoot: resolvedRight,
      mode: mode ?? 'quick',
    },
  };
}
