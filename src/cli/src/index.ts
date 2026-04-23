#!/usr/bin/env node
import { parseCliArgs } from './args.js';

/**
 * CLI entry point. For v1 this simply validates the invocation and prints
 * the parsed session; a later task will hand off to the running desktop
 * app via a named IPC socket (falling back to spawning a new instance).
 */
function main(argv: readonly string[]): number {
  try {
    const parsed = parseCliArgs(argv);
    process.stdout.write(
      `AwapiCompare CLI\n  left:  ${parsed.left}\n  right: ${parsed.right}\n  mode:  ${parsed.mode}\n` +
        (parsed.rulesFile ? `  rules: ${parsed.rulesFile}\n` : ''),
    );
    // TODO(Phase 10): hand off to running app / spawn new instance.
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`awapi-compare: ${msg}\n`);
    process.stderr.write('Usage: awapi-compare <left> <right> [--mode quick|thorough|binary] [--rules file]\n');
    return 2;
  }
}

process.exit(main(process.argv.slice(2)));
