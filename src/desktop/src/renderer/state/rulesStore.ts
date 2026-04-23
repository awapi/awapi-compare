import { create } from 'zustand';

import type { Rule, RuleVerdict, RulesTestRequest } from '@awapi/shared';

/**
 * Store for the **global** rule set. Per-session rules live on the
 * session store. Global rules are loaded from the main process on mount
 * and persisted back via `window.awapi.rules.set`.
 */
export interface RulesState {
  rules: Rule[];
  loaded: boolean;
  /** Replace the in-memory list (no persistence). Used by `load()`. */
  setRules(rules: Rule[]): void;
  /** Mark the store as loaded after the initial fetch. */
  markLoaded(): void;
}

export interface CreateRulesStoreOptions {
  initial?: Rule[];
}

export function createRulesStore(opts: CreateRulesStoreOptions = {}) {
  return create<RulesState>((set) => ({
    rules: opts.initial ?? [],
    loaded: false,
    setRules: (rules) => set({ rules }),
    markLoaded: () => set({ loaded: true }),
  }));
}

export type RulesStore = ReturnType<typeof createRulesStore>;

/** Default sample paths shown in the editor's live-preview pane. */
export const DEFAULT_SAMPLE_PATHS: ReadonlyArray<string> = [
  'src/index.ts',
  'src/components/App.tsx',
  'src/__tests__/App.test.tsx',
  'build/out.js',
  'node_modules/foo/index.js',
  '.git/HEAD',
  'README.md',
  'logs/2026-04-22.log',
];

/**
 * Convenience wrapper around `window.awapi.rules.test`. Falls back to a
 * synchronous, all-`'kept'` result when the bridge is unavailable
 * (e.g. in tests / SSR), so the UI can render without the preload layer.
 */
export async function previewVerdicts(
  req: RulesTestRequest,
): Promise<RuleVerdict[]> {
  const api = (globalThis as { awapi?: typeof window.awapi }).awapi;
  if (!api?.rules?.test) {
    return req.samples.map(() => 'kept' as const);
  }
  const res = await api.rules.test(req);
  return res.verdicts;
}
