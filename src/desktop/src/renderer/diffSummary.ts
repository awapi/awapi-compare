import type { ComparedPair, DiffStatus } from '@awapi/shared';

export type DiffSummary = Record<DiffStatus, number> & { total: number };

export function emptyDiffSummary(): DiffSummary {
  return {
    'left-only': 0,
    'right-only': 0,
    identical: 0,
    different: 0,
    'newer-left': 0,
    'newer-right': 0,
    excluded: 0,
    error: 0,
    total: 0,
  };
}

/**
 * Tally compared pairs by {@link DiffStatus}. Pure function used by the
 * status bar to render counts without re-iterating on every render.
 */
export function summarize(pairs: readonly ComparedPair[]): DiffSummary {
  const summary = emptyDiffSummary();
  for (const pair of pairs) {
    summary[pair.status] += 1;
    summary.total += 1;
  }
  return summary;
}
