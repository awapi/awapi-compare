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
 *
 * Environment variables (handy for `just dev`):
 *
 *   AWAPI_LEFT, AWAPI_RIGHT, AWAPI_TYPE, AWAPI_MODE
 *
 * Returns `null` when neither flag nor env var is set. Throws on
 * malformed input. Unknown flags are ignored — Electron and
 * `electron-vite` inject their own (e.g. `--remote-debugging-port`)
 * which we must not reject.
 */
export interface ParseDesktopArgsOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

const MODES: ReadonlySet<CompareMode> = new Set(['quick', 'thorough', 'binary']);

export function parseDesktopArgs(
  argv: readonly string[],
  options: ParseDesktopArgsOptions = {},
): InitialCompareSession | null {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;

  let left: string | undefined;
  let right: string | undefined;
  let mode: CompareMode | undefined;
  let typeSeen = false;

  const requireValue = (raw: string | undefined, flag: string): string => {
    if (raw === undefined || raw.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return raw;
  };

  const assertType = (v: string): void => {
    if (v !== 'folder') {
      throw new Error(`--type must be 'folder' (got '${v}'); file mode is not yet supported`);
    }
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
      assertType(requireValue(argv[++i], '--type'));
      typeSeen = true;
    } else if (arg?.startsWith('--type=')) {
      assertType(arg.slice('--type='.length));
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
    }
    // anything else is ignored (Electron internal flags, etc.)
  }

  // Env-var fallbacks.
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
    if (v && v.length > 0) assertType(v);
  }

  if (left === undefined && right === undefined) return null;
  if (left === undefined || right === undefined) {
    throw new Error('Both --left and --right are required when either is provided');
  }

  return {
    type: 'folder',
    leftRoot: isAbsolute(left) ? left : resolve(cwd, left),
    rightRoot: isAbsolute(right) ? right : resolve(cwd, right),
    mode: mode ?? 'quick',
  };
}
