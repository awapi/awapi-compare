import type { CompareMode } from '@awapi/shared';

export interface ParsedCli {
  left: string;
  right: string;
  mode: CompareMode;
  rulesFile?: string;
}

const MODES: ReadonlySet<CompareMode> = new Set(['quick', 'thorough', 'binary']);

/**
 * Pure argument parser — separated from the Commander wiring so it can be
 * unit-tested without side effects.
 *
 * Accepts already-tokenized arguments (no `node script.js` prefix).
 */
export function parseCliArgs(argv: readonly string[]): ParsedCli {
  let mode: CompareMode = 'quick';
  let rulesFile: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mode' || arg === '-m') {
      const value = argv[++i];
      if (!value || !MODES.has(value as CompareMode)) {
        throw new Error(`--mode must be one of: ${[...MODES].join(', ')}`);
      }
      mode = value as CompareMode;
    } else if (arg === '--rules' || arg === '-r') {
      const value = argv[++i];
      if (!value) throw new Error('--rules requires a file path');
      rulesFile = value;
    } else if (arg?.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (!MODES.has(value as CompareMode)) {
        throw new Error(`--mode must be one of: ${[...MODES].join(', ')}`);
      }
      mode = value as CompareMode;
    } else if (arg?.startsWith('--rules=')) {
      rulesFile = arg.slice('--rules='.length);
    } else if (arg?.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }

  if (positional.length !== 2) {
    throw new Error('Expected exactly two positional arguments: <left> <right>');
  }

  return {
    left: positional[0]!,
    right: positional[1]!,
    mode,
    rulesFile,
  };
}
