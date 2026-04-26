/**
 * Beyond-Compare-style "Simple" rules view (Phase 6.1).
 *
 * The full {@link Rule} engine is intentionally expressive — ordered,
 * last-match-wins, with `kind` × `target` × `scope` × glob plus
 * optional `size` / `mtime` predicates. That power makes the common
 * case ("hide `.git` and `node_modules`, show only `.ts` files") more
 * verbose than it needs to be.
 *
 * The Simple view exposes four flat axes, mirroring Beyond Compare's
 * "Name Filters" tab:
 *
 *   - Include files   — globs whitelisting file basenames   (default: `**`)
 *   - Exclude files   — globs blacklisting file basenames   (default:  none)
 *   - Include folders — globs whitelisting folder basenames (default: `*`)
 *   - Exclude folders — globs blacklisting folder basenames (default:  none)
 *
 * `compileSimpleRules` produces an ordered, scope-aware {@link Rule}[]
 * that the engine evaluates without any special casing. The inverse
 * `tryDecompileToSimpleRules` returns the four-axis payload when a
 * rule list is structurally a simple-view rule set, or `null` when it
 * uses advanced features (predicates, custom ordering, manual scopes
 * the simple view can't express). This lets the editor decide whether
 * to show the Simple tab as the source of truth or fall back to the
 * Advanced editor.
 *
 * Pure module — no `electron`, no Node APIs. 100% test coverage.
 */

import type { Rule, RuleScope } from './types.js';

/** Default include-files glob ("everything"). */
export const SIMPLE_INCLUDE_FILES_DEFAULT = '**';
/** Default include-folders glob ("everything"). */
export const SIMPLE_INCLUDE_FOLDERS_DEFAULT = '*';

export interface SimpleRulesPayload {
  /** Globs whitelisting file basenames. */
  includeFiles: string[];
  /** Globs blacklisting file basenames. */
  excludeFiles: string[];
  /** Globs whitelisting folder basenames. */
  includeFolders: string[];
  /** Globs blacklisting folder basenames. */
  excludeFolders: string[];
}

/** Empty-but-valid simple payload (BC defaults: all in, nothing excluded). */
export const EMPTY_SIMPLE_RULES: SimpleRulesPayload = {
  includeFiles: [SIMPLE_INCLUDE_FILES_DEFAULT],
  excludeFiles: [],
  includeFolders: [SIMPLE_INCLUDE_FOLDERS_DEFAULT],
  excludeFolders: [],
};

interface CompileOptions {
  /**
   * Optional id factory — injected by the renderer so generated rule
   * ids are stable enough for React keys. Defaults to a counter so the
   * pure helper has no `crypto` dependency.
   */
  newId?: () => string;
}

function defaultIdFactory(): () => string {
  let n = 0;
  return () => `simple-${++n}`;
}

function trimAxis(values: ReadonlyArray<string>): string[] {
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

/**
 * Compile a four-axis simple payload into the canonical ordered rule
 * list. The order is fixed:
 *
 *   1. exclude-folders (one or two rules per glob, see below)
 *   2. exclude-files
 *   3. include-folders   — only emitted when the user customised it
 *   4. include-files     — only emitted when the user customised it
 *
 * **Folder excludes** emit two rules per glob so both the folder
 * entry itself *and* everything beneath it are dropped:
 *
 *   - `{ kind: 'exclude', target: 'name', scope: 'folder', pattern: '<glob>' }`
 *   - `{ kind: 'exclude', target: 'path', pattern: '** / <glob> / **' }`
 *
 * Whitelist mode is per-scope (see {@link Rule.scope}), so emitting
 * include-files only when the user changed the default avoids the
 * surprise of "I added one file include and now all my folders
 * disappeared". When include rules are emitted, the engine flips to
 * whitelist mode for that scope only.
 */
export function compileSimpleRules(
  payload: SimpleRulesPayload,
  options: CompileOptions = {},
): Rule[] {
  const newId = options.newId ?? defaultIdFactory();
  const out: Rule[] = [];

  const excludeFolders = trimAxis(payload.excludeFolders);
  const excludeFiles = trimAxis(payload.excludeFiles);
  const includeFolders = trimAxis(payload.includeFolders);
  const includeFiles = trimAxis(payload.includeFiles);

  for (const glob of excludeFolders) {
    out.push({
      id: newId(),
      kind: 'exclude',
      target: 'name',
      scope: 'folder',
      pattern: glob,
      enabled: true,
    });
    out.push({
      id: newId(),
      kind: 'exclude',
      target: 'path',
      pattern: `**/${glob}/**`,
      enabled: true,
    });
  }

  for (const glob of excludeFiles) {
    out.push({
      id: newId(),
      kind: 'exclude',
      target: 'name',
      scope: 'file',
      pattern: glob,
      enabled: true,
    });
  }

  // Includes are only emitted when the user changed the defaults.
  // Otherwise the rule set stays in "default-keep" mode for that scope.
  const customisedIncludeFolders = !isDefaultIncludeFolders(includeFolders);
  const customisedIncludeFiles = !isDefaultIncludeFiles(includeFiles);

  if (customisedIncludeFolders) {
    for (const glob of includeFolders) {
      out.push({
        id: newId(),
        kind: 'include',
        target: 'name',
        scope: 'folder',
        pattern: glob,
        enabled: true,
      });
    }
  }

  if (customisedIncludeFiles) {
    for (const glob of includeFiles) {
      out.push({
        id: newId(),
        kind: 'include',
        target: 'name',
        scope: 'file',
        pattern: glob,
        enabled: true,
      });
    }
  }

  return out;
}

function isDefaultIncludeFiles(globs: ReadonlyArray<string>): boolean {
  return globs.length === 0 || (globs.length === 1 && globs[0] === SIMPLE_INCLUDE_FILES_DEFAULT);
}

function isDefaultIncludeFolders(globs: ReadonlyArray<string>): boolean {
  return (
    globs.length === 0 || (globs.length === 1 && globs[0] === SIMPLE_INCLUDE_FOLDERS_DEFAULT)
  );
}

/**
 * Inverse of {@link compileSimpleRules}.
 *
 * Returns the four-axis payload when `rules` is structurally a
 * simple-view rule set, or `null` when it uses features the simple
 * view cannot express (size/mtime predicates, disabled rules, mixed
 * scopes, custom ordering, unrecognised include/exclude shapes).
 *
 * The check is intentionally strict: the editor uses a `null` result
 * to gate the "edit in Advanced tab" banner, and we'd rather force the
 * Advanced tab than silently reshape the user's rules.
 */
export function tryDecompileToSimpleRules(
  rules: ReadonlyArray<Rule>,
): SimpleRulesPayload | null {
  if (rules.length === 0) {
    return { ...EMPTY_SIMPLE_RULES };
  }

  for (const r of rules) {
    if (!r.enabled) return null;
    if (r.size !== undefined) return null;
    if (r.mtime !== undefined) return null;
  }

  // Phase 1: classify each rule. Reject anything we don't recognise.
  type Tag =
    | { kind: 'exclude-folder-name'; glob: string }
    | { kind: 'exclude-folder-path'; glob: string }
    | { kind: 'exclude-file'; glob: string }
    | { kind: 'include-folder'; glob: string }
    | { kind: 'include-file'; glob: string };

  const tags: Tag[] = [];
  for (const r of rules) {
    const tag = classifyRule(r);
    if (tag === null) return null;
    tags.push(tag);
  }

  // Phase 2: enforce canonical ordering: all exclude-folder pairs,
  // then exclude-files, then include-folders, then include-files.
  const order: Record<Tag['kind'], number> = {
    'exclude-folder-name': 0,
    'exclude-folder-path': 0,
    'exclude-file': 1,
    'include-folder': 2,
    'include-file': 3,
  };
  for (let i = 1; i < tags.length; i++) {
    const a = tags[i - 1]!;
    const b = tags[i]!;
    if (order[a.kind] > order[b.kind]) return null;
  }

  // Phase 3: every exclude-folder-name must be immediately followed
  // by its descendant pair (exclude-folder-path with `**/<glob>/**`).
  const excludeFolders: string[] = [];
  const excludeFiles: string[] = [];
  const includeFolders: string[] = [];
  const includeFiles: string[] = [];

  let i = 0;
  while (i < tags.length) {
    const t = tags[i]!;
    if (t.kind === 'exclude-folder-name') {
      const next = tags[i + 1];
      if (!next || next.kind !== 'exclude-folder-path' || next.glob !== t.glob) {
        return null;
      }
      excludeFolders.push(t.glob);
      i += 2;
      continue;
    }
    if (t.kind === 'exclude-folder-path') {
      // A path rule without its preceding name pair → not simple.
      return null;
    }
    if (t.kind === 'exclude-file') {
      excludeFiles.push(t.glob);
      i++;
      continue;
    }
    if (t.kind === 'include-folder') {
      includeFolders.push(t.glob);
      i++;
      continue;
    }
    if (t.kind === 'include-file') {
      includeFiles.push(t.glob);
      i++;
      continue;
    }
    // Exhaustiveness: classifyRule's union has 5 members, all handled
    // above. TypeScript narrows `t` to `never` here.
    void (t satisfies never);
  }

  return {
    includeFiles: includeFiles.length > 0 ? includeFiles : [SIMPLE_INCLUDE_FILES_DEFAULT],
    excludeFiles,
    includeFolders:
      includeFolders.length > 0 ? includeFolders : [SIMPLE_INCLUDE_FOLDERS_DEFAULT],
    excludeFolders,
  };
}

function classifyRule(r: Rule):
  | { kind: 'exclude-folder-name'; glob: string }
  | { kind: 'exclude-folder-path'; glob: string }
  | { kind: 'exclude-file'; glob: string }
  | { kind: 'include-folder'; glob: string }
  | { kind: 'include-file'; glob: string }
  | null {
  const target = r.target ?? 'path';
  const scope: RuleScope = r.scope ?? 'any';

  if (r.kind === 'exclude') {
    if (target === 'name' && scope === 'folder') {
      return { kind: 'exclude-folder-name', glob: r.pattern };
    }
    if (target === 'name' && scope === 'file') {
      return { kind: 'exclude-file', glob: r.pattern };
    }
    if (target === 'path' && scope === 'any') {
      const m = /^\*\*\/(.+)\/\*\*$/.exec(r.pattern);
      if (m && m[1] !== undefined) {
        return { kind: 'exclude-folder-path', glob: m[1] };
      }
    }
    return null;
  }

  // include
  if (target !== 'name') return null;
  if (scope === 'folder') return { kind: 'include-folder', glob: r.pattern };
  if (scope === 'file') return { kind: 'include-file', glob: r.pattern };
  return null;
}
