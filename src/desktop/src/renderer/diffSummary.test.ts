import { describe, expect, it } from 'vitest';
import type { ComparedPair } from '@awapi/shared';
import { emptyDiffSummary, summarize } from './diffSummary.js';

function pair(relPath: string, status: ComparedPair['status']): ComparedPair {
  return { relPath, status };
}

describe('diffSummary', () => {
  it('returns zeroed summary for empty input', () => {
    expect(summarize([])).toEqual(emptyDiffSummary());
  });

  it('tallies each status and total', () => {
    const pairs: ComparedPair[] = [
      pair('a', 'identical'),
      pair('b', 'identical'),
      pair('c', 'different'),
      pair('d', 'left-only'),
      pair('e', 'right-only'),
      pair('f', 'newer-left'),
      pair('g', 'newer-right'),
      pair('h', 'excluded'),
      pair('i', 'error'),
    ];
    const s = summarize(pairs);
    expect(s.identical).toBe(2);
    expect(s.different).toBe(1);
    expect(s['left-only']).toBe(1);
    expect(s['right-only']).toBe(1);
    expect(s['newer-left']).toBe(1);
    expect(s['newer-right']).toBe(1);
    expect(s.excluded).toBe(1);
    expect(s.error).toBe(1);
    expect(s.total).toBe(pairs.length);
  });

  it('does not mutate the input array', () => {
    const pairs: ComparedPair[] = [pair('a', 'identical')];
    const before = [...pairs];
    summarize(pairs);
    expect(pairs).toEqual(before);
  });
});
