import type { Rule, RuleVerdict, RulesTestRequest, RulesTestResponse } from '@awapi/shared';

import { evaluateAll } from './ruleMatcher.js';

/**
 * Async filesystem surface required for persistence. Mirrors the shape
 * of `node:fs/promises` so tests can swap in `memfs.fs.promises`.
 */
export interface RulesFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, contents: string, encoding: 'utf8'): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
}

export interface RulesServiceDeps {
  /**
   * Absolute path to the JSON file holding the **global** rule set.
   * Typically `<userData>/rules.json`. When omitted, the service runs
   * in memory only — useful for tests and CLI contexts.
   */
  filePath?: string;
  /** Injectable `fs.promises`. Defaults to `node:fs/promises`. */
  fs?: RulesFs;
  /** Directory of {@link filePath}, used when creating it. */
  dirPath?: string;
}

interface RulesFile {
  version: 1;
  rules: Rule[];
}

/**
 * Persistent global rule set. Per-session rules live on the
 * {@link Session} object; the merged effective set used by a scan is
 * computed by the renderer (`globalRules` + `session.rules`).
 *
 * The service is intentionally tolerant of missing/corrupt files on
 * `load()` — a fresh install simply returns an empty list.
 */
export class RulesService {
  private rules: Rule[] = [];
  private loaded = false;

  constructor(private readonly deps: RulesServiceDeps = {}) {}

  /**
   * Load the rule set from disk if a {@link RulesServiceDeps.filePath}
   * was provided. Safe to call multiple times; subsequent calls re-read.
   * Missing / unparseable files yield an empty rule set rather than
   * throwing.
   */
  async load(): Promise<void> {
    this.loaded = true;
    if (!this.deps.filePath || !this.deps.fs) {
      this.rules = [];
      return;
    }
    try {
      const raw = await this.deps.fs.readFile(this.deps.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RulesFile> | Rule[];
      this.rules = normalize(parsed);
    } catch (err) {
      if (isNotFound(err)) {
        this.rules = [];
        return;
      }
      // Corrupt JSON / unreadable file — log via console (main process)
      // and fall back to empty rather than crash the app on launch.
      console.warn('[rules] failed to load rules.json; starting empty:', err);
      this.rules = [];
    }
  }

  async get(): Promise<Rule[]> {
    if (!this.loaded) await this.load();
    return this.rules.map(cloneRule);
  }

  async set(rules: Rule[]): Promise<void> {
    this.rules = rules.map(cloneRule);
    this.loaded = true;
    await this.flush();
  }

  /** Persist the current rule set to {@link RulesServiceDeps.filePath}. */
  async flush(): Promise<void> {
    if (!this.deps.filePath || !this.deps.fs) return;
    if (this.deps.dirPath) {
      try {
        await this.deps.fs.mkdir(this.deps.dirPath, { recursive: true });
      } catch {
        // best-effort; writeFile will surface the real error if needed
      }
    }
    const payload: RulesFile = { version: 1, rules: this.rules };
    await this.deps.fs.writeFile(
      this.deps.filePath,
      JSON.stringify(payload, null, 2),
      'utf8',
    );
  }

  /**
   * Pure helper used by the `rules.test` IPC handler that backs the
   * rules-editor live preview. Does not touch the persisted state.
   */
  test(req: RulesTestRequest): RulesTestResponse {
    const verdicts: RuleVerdict[] = evaluateAll(req.rules, req.samples);
    return { verdicts };
  }
}

function cloneRule(r: Rule): Rule {
  return {
    id: r.id,
    kind: r.kind,
    pattern: r.pattern,
    enabled: r.enabled,
    ...(r.target !== undefined ? { target: r.target } : {}),
    ...(r.size !== undefined ? { size: { ...r.size } } : {}),
    ...(r.mtime !== undefined ? { mtime: { ...r.mtime } } : {}),
  };
}

function normalize(parsed: Partial<RulesFile> | Rule[]): Rule[] {
  const list = Array.isArray(parsed) ? parsed : (parsed.rules ?? []);
  if (!Array.isArray(list)) return [];
  return list.filter(isRule).map(cloneRule);
}

function isRule(value: unknown): value is Rule {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r['id'] === 'string' &&
    (r['kind'] === 'include' || r['kind'] === 'exclude') &&
    typeof r['pattern'] === 'string' &&
    typeof r['enabled'] === 'boolean'
  );
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
