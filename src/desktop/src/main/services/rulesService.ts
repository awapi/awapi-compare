import type { Rule } from '@awapi/shared';

import { NotImplementedError } from './errors.js';

/**
 * Rules persistence (global + per-session). Real implementation lands in
 * Phase 6 (rules engine). The skeleton keeps rules in memory so the app
 * can boot before persistence is wired to disk.
 */
export class RulesService {
  private rules: Rule[] = [];

  get(): Promise<Rule[]> {
    return Promise.resolve([...this.rules]);
  }

  set(rules: Rule[]): Promise<void> {
    this.rules = [...rules];
    return Promise.resolve();
  }

  /** Persist the current rule set to `userData`. Implemented in Phase 6. */
  flush(): Promise<void> {
    throw new NotImplementedError('rules.flush', 'Phase 6');
  }
}
