import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DIFF_OPTIONS,
  DEFAULT_MTIME_TOLERANCE_SECONDS,
  ONE_HOUR_MS,
  cloneDiffOptions,
  diffOptionsFromMode,
  mergeDiffOptions,
  mtimeDeltaWithinTolerance,
} from './diffOptions.js';

describe('DEFAULT_DIFF_OPTIONS', () => {
  it('matches the documented conservative defaults', () => {
    expect(DEFAULT_DIFF_OPTIONS).toEqual({
      attributes: {
        size: true,
        mtime: {
          enabled: true,
          toleranceSeconds: DEFAULT_MTIME_TOLERANCE_SECONDS,
          ignoreDstShift: false,
          ignoreTimezone: false,
        },
      },
      pairing: { caseSensitive: true, ignoreExtension: false, unicodeNormalize: true },
      content: { mode: 'checksum', skipWhenAttributesMatch: true, overrideAttributesResult: true },
    });
  });

  it('is frozen so callers cannot mutate it', () => {
    expect(Object.isFrozen(DEFAULT_DIFF_OPTIONS)).toBe(true);
  });
});

describe('mergeDiffOptions', () => {
  it('returns a fresh independent copy when no override is given', () => {
    const a = mergeDiffOptions();
    const b = mergeDiffOptions(null);
    expect(a).toEqual(DEFAULT_DIFF_OPTIONS);
    expect(b).toEqual(DEFAULT_DIFF_OPTIONS);
    expect(a).not.toBe(DEFAULT_DIFF_OPTIONS);
    a.attributes.size = false;
    expect(b.attributes.size).toBe(true);
  });

  it('merges nested partial fields without dropping siblings', () => {
    const merged = mergeDiffOptions({
      attributes: { mtime: { toleranceSeconds: 5 } },
      pairing: { caseSensitive: false },
      content: { mode: 'off' },
    });
    expect(merged.attributes.size).toBe(true);
    expect(merged.attributes.mtime.toleranceSeconds).toBe(5);
    expect(merged.attributes.mtime.enabled).toBe(true);
    expect(merged.pairing.caseSensitive).toBe(false);
    expect(merged.pairing.unicodeNormalize).toBe(true);
    expect(merged.content.mode).toBe('off');
    expect(merged.content.overrideAttributesResult).toBe(true);
  });
});

describe('diffOptionsFromMode', () => {
  it.each([
    ['quick', 'off'],
    ['thorough', 'checksum'],
    ['binary', 'binary'],
  ] as const)('maps %s → content.mode = %s', (mode, expected) => {
    expect(diffOptionsFromMode(mode).content.mode).toBe(expected);
  });

  it('preserves the rest of the defaults', () => {
    const o = diffOptionsFromMode('quick');
    expect(o.attributes).toEqual(DEFAULT_DIFF_OPTIONS.attributes);
    expect(o.pairing).toEqual(DEFAULT_DIFF_OPTIONS.pairing);
  });
});

describe('cloneDiffOptions', () => {
  it('produces a deep, mutable copy', () => {
    const a = cloneDiffOptions(DEFAULT_DIFF_OPTIONS);
    a.attributes.mtime.toleranceSeconds = 99;
    expect(DEFAULT_DIFF_OPTIONS.attributes.mtime.toleranceSeconds).toBe(2);
    expect(a.attributes.mtime.toleranceSeconds).toBe(99);
  });
});

describe('mtimeDeltaWithinTolerance', () => {
  const baseMtime = DEFAULT_DIFF_OPTIONS.attributes.mtime;

  it('returns true when mtime is disabled regardless of skew', () => {
    expect(
      mtimeDeltaWithinTolerance(0, 1_000_000_000, { ...baseMtime, enabled: false }),
    ).toBe(true);
  });

  it('respects the configured tolerance window (seconds)', () => {
    const opts = { ...baseMtime, toleranceSeconds: 2 };
    expect(mtimeDeltaWithinTolerance(1_000, 1_000 + 2_000, opts)).toBe(true);
    expect(mtimeDeltaWithinTolerance(1_000, 1_000 + 2_001, opts)).toBe(false);
    expect(mtimeDeltaWithinTolerance(1_000, 1_000 - 2_000, opts)).toBe(true);
  });

  it('treats negative tolerance as zero (defensive)', () => {
    const opts = { ...baseMtime, toleranceSeconds: -5 };
    expect(mtimeDeltaWithinTolerance(1, 1, opts)).toBe(true);
    expect(mtimeDeltaWithinTolerance(1, 2, opts)).toBe(false);
  });

  it('ignoreDstShift accepts a 1h offset within tolerance', () => {
    const opts = { ...baseMtime, ignoreDstShift: true, toleranceSeconds: 2 };
    expect(mtimeDeltaWithinTolerance(0, ONE_HOUR_MS, opts)).toBe(true);
    expect(mtimeDeltaWithinTolerance(0, ONE_HOUR_MS + 1_500, opts)).toBe(true);
    expect(mtimeDeltaWithinTolerance(0, ONE_HOUR_MS + 5_000, opts)).toBe(false);
  });

  it('ignoreTimezone folds whole-hour offsets to zero', () => {
    const opts = { ...baseMtime, ignoreTimezone: true, toleranceSeconds: 2 };
    expect(mtimeDeltaWithinTolerance(0, 5 * ONE_HOUR_MS, opts)).toBe(true);
    expect(mtimeDeltaWithinTolerance(0, 5 * ONE_HOUR_MS + 1_000, opts)).toBe(true);
    expect(mtimeDeltaWithinTolerance(0, 5 * ONE_HOUR_MS + 5_000, opts)).toBe(false);
    // Folds the *near side* of the hour boundary too.
    expect(mtimeDeltaWithinTolerance(0, 5 * ONE_HOUR_MS - 1_000, opts)).toBe(true);
  });

  it('ignoreTimezone + ignoreDstShift both apply', () => {
    const opts = {
      ...baseMtime,
      ignoreTimezone: true,
      ignoreDstShift: true,
      toleranceSeconds: 2,
    };
    // 5h + 30m skew is not within tolerance even after folding (folds to 30m).
    expect(mtimeDeltaWithinTolerance(0, 5 * ONE_HOUR_MS + 30 * 60 * 1000, opts)).toBe(false);
    // But a 4h59m skew folds to 1m → within tolerance.
    expect(
      mtimeDeltaWithinTolerance(0, 5 * ONE_HOUR_MS - 60 * 1000, opts),
    ).toBe(false); // 1m > 2s
    expect(mtimeDeltaWithinTolerance(0, 5 * ONE_HOUR_MS - 1_000, opts)).toBe(true);
  });
});
