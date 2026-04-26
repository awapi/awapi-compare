import picomatch from 'picomatch';

import type { EntryType, FsEntry, Rule, RuleScope, RuleVerdict } from '@awapi/shared';

export type { RuleVerdict };

/**
 * Ordered rule evaluation (Phase 6 + Phase 6.1).
 *
 * Semantics — modelled loosely on `.gitignore`:
 *
 * 1. A rule's optional `scope` (`'file'` | `'folder'` | `'any'`)
 *    controls which entry kinds it applies to. `scope: 'file'` rules
 *    are skipped entirely for directory entries and vice versa.
 * 2. **Whitelist mode is evaluated per scope.** If the rule set
 *    contains at least one enabled `include` rule whose scope applies
 *    to the entry, the default verdict for an entry that matches no
 *    rule becomes `'excluded'`. Otherwise, the default is `'kept'`.
 *    This means a Simple-view rule set that filters files
 *    (`include files: *.ts`) does not accidentally drop every folder.
 * 3. Rules are evaluated **in order**. For every rule whose pattern,
 *    scope, and predicates match the entry, the verdict is updated to
 *    that rule's `kind`. The **last matching rule wins**, so users can
 *    express overrides (`exclude **`, `include src/**`).
 * 4. Disabled rules are ignored.
 *
 * Pattern matching uses [picomatch][1]. Negation patterns (`!pattern`)
 * are supported natively by picomatch; combined with the `kind` field
 * they let users express the common cases either via order
 * (`exclude *.log` then `include important.log`) or via a single
 * negated pattern (`exclude !important.log`).
 *
 * [1]: https://github.com/micromatch/picomatch
 */
interface CompiledRule {
  rule: Rule;
  scope: RuleScope;
  /** Returns true when the rule's pattern + predicates match the entry. */
  test: (entry: {
    relPath: string;
    name: string;
    size?: number;
    mtimeMs?: number;
  }) => boolean;
}

function compile(rule: Rule): CompiledRule {
  // `dot: true` so dotfiles match `**` like everything else.
  // `nocase: false` keeps case-sensitive behaviour on POSIX; users can
  // express case-insensitive matches with character classes if needed.
  const matcher = picomatch(rule.pattern, { dot: true, nocase: false });
  const target = rule.target ?? 'path';
  return {
    rule,
    scope: rule.scope ?? 'any',
    test: (entry) => {
      const subject = target === 'name' ? entry.name : entry.relPath;
      if (!matcher(subject)) return false;
      return predicatesMatch(rule, entry);
    },
  };
}

/** Compile a rule set once; reuse across thousands of entries. */
export function compileRules(rules: Rule[]): CompiledRule[] {
  return rules.filter((r) => r.enabled).map(compile);
}

function predicatesMatch(
  rule: Rule,
  entry: { size?: number; mtimeMs?: number },
): boolean {
  if (rule.size) {
    const size = entry.size;
    if (size === undefined) return false;
    if (rule.size.gt !== undefined && !(size > rule.size.gt)) return false;
    if (rule.size.lt !== undefined && !(size < rule.size.lt)) return false;
  }
  if (rule.mtime) {
    const mtimeMs = entry.mtimeMs;
    if (mtimeMs === undefined) return false;
    if (rule.mtime.after !== undefined && !(mtimeMs > rule.mtime.after)) return false;
    if (rule.mtime.before !== undefined && !(mtimeMs < rule.mtime.before)) return false;
  }
  return true;
}

/**
 * Map an `EntryType` to the {@link RuleScope} value that addresses it.
 * Symlinks are treated as files for scope purposes — a Simple-view
 * "exclude files: *.lnk" rule should still drop a symlink named that
 * way. Directory-pointing symlinks would be reported as `'symlink'`
 * here too; today the scanner doesn't follow them by default, so the
 * file-scope mapping is the safer default.
 */
function entryScope(type: EntryType | undefined): RuleScope {
  return type === 'dir' ? 'folder' : 'file';
}

function scopeApplies(ruleScope: RuleScope, entryScopeValue: RuleScope): boolean {
  return ruleScope === 'any' || ruleScope === entryScopeValue;
}

/**
 * Evaluate a compiled rule set against a single entry. Pure; no IO.
 *
 * Accepts either a full {@link FsEntry} (used by the scanner) or a
 * partial sample (used by the rules-editor live preview).
 */
export function evaluate(
  compiled: CompiledRule[],
  entry:
    | FsEntry
    | {
        relPath: string;
        name?: string;
        type?: EntryType;
        size?: number;
        mtimeMs?: number;
      },
): RuleVerdict {
  if (compiled.length === 0) return 'kept';

  const subject = {
    relPath: entry.relPath,
    name: entry.name ?? basename(entry.relPath),
    size: 'size' in entry ? entry.size : undefined,
    mtimeMs: 'mtimeMs' in entry ? entry.mtimeMs : undefined,
  };
  const eScope = entryScope('type' in entry ? entry.type : undefined);

  // Per-scope whitelist mode: only flip if at least one include rule
  // would actually apply to this entry's scope.
  const hasIncludeForScope = compiled.some(
    (c) => c.rule.kind === 'include' && scopeApplies(c.scope, eScope),
  );
  let kept = !hasIncludeForScope;
  for (const c of compiled) {
    if (!scopeApplies(c.scope, eScope)) continue;
    if (!c.test(subject)) continue;
    kept = c.rule.kind === 'include';
  }
  return kept ? 'kept' : 'excluded';
}

/**
 * Convenience: compile + evaluate a list of samples in one call. Used by
 * the `rules.test` IPC handler that backs the live-preview pane.
 */
export function evaluateAll(
  rules: Rule[],
  samples: ReadonlyArray<{
    relPath: string;
    name?: string;
    type?: EntryType;
    size?: number;
    mtimeMs?: number;
  }>,
): RuleVerdict[] {
  const compiled = compileRules(rules);
  return samples.map((s) => evaluate(compiled, s));
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}
