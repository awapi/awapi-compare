import picomatch from 'picomatch';

import type { FsEntry, Rule } from '@awapi/shared';

/**
 * Result of evaluating a set of rules against a single entry.
 * `'excluded'` means the entry should be dropped from the scan; `'kept'`
 * means it passed through. The exact semantics are:
 *
 * 1. If any enabled `include` rule matches, the entry is kept.
 * 2. Otherwise, if any enabled `exclude` rule matches, the entry is dropped.
 * 3. Otherwise, the entry is kept (no rules configured ⇒ keep everything).
 *
 * This mirrors the order-independent behaviour we want for the scanner
 * (Phase 4). Phase 6 replaces this with an ordered, user-editable engine.
 */
export type RuleVerdict = 'kept' | 'excluded';

interface CompiledRule {
  rule: Rule;
  test: (relPath: string) => boolean;
}

function compile(rule: Rule): CompiledRule {
  const matcher = picomatch(rule.pattern, { dot: true, nocase: false });
  return {
    rule,
    test: (relPath) => {
      if (!matcher(relPath)) return false;
      if (rule.size) {
        // Size predicates only make sense with a concrete entry; we apply
        // them in `evaluate` where we have the FsEntry. The pattern test
        // is the cheap path.
      }
      return true;
    },
  };
}

/** Compile a rule set once; reuse across thousands of entries. */
export function compileRules(rules: Rule[]): CompiledRule[] {
  return rules.filter((r) => r.enabled).map(compile);
}

function predicatesMatch(rule: Rule, entry: FsEntry): boolean {
  if (rule.size) {
    if (rule.size.gt !== undefined && !(entry.size > rule.size.gt)) return false;
    if (rule.size.lt !== undefined && !(entry.size < rule.size.lt)) return false;
  }
  if (rule.mtime) {
    if (rule.mtime.after !== undefined && !(entry.mtimeMs > rule.mtime.after)) return false;
    if (rule.mtime.before !== undefined && !(entry.mtimeMs < rule.mtime.before)) return false;
  }
  return true;
}

/**
 * Evaluate a compiled rule set against a single entry. Pure; no IO.
 */
export function evaluate(compiled: CompiledRule[], entry: FsEntry): RuleVerdict {
  if (compiled.length === 0) return 'kept';

  let anyInclude = false;
  let includeMatched = false;
  let excludeMatched = false;
  for (const c of compiled) {
    if (c.rule.kind === 'include') {
      anyInclude = true;
      if (c.test(entry.relPath) && predicatesMatch(c.rule, entry)) {
        includeMatched = true;
      }
    } else if (c.test(entry.relPath) && predicatesMatch(c.rule, entry)) {
      excludeMatched = true;
    }
  }

  if (anyInclude && !includeMatched) return 'excluded';
  if (excludeMatched && !includeMatched) return 'excluded';
  return 'kept';
}
