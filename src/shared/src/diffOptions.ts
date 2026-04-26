import type { CompareMode, ContentCompareMode, DiffOptions } from './types.js';

/**
 * Default mtime equality window. Two seconds matches the precision of
 * older filesystems (FAT) and the historical Phase 4 behaviour.
 */
export const DEFAULT_MTIME_TOLERANCE_SECONDS = 2;

/** One hour in milliseconds — used by DST / timezone reductions. */
export const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * The factory default {@link DiffOptions}. Conservative settings:
 * compare both size and mtime (2 s tolerance), case-sensitive pairing,
 * Unicode-normalised filenames, and a checksum-based content compare
 * that is skipped when attributes already say identical and overrides
 * the attribute verdict otherwise.
 */
export const DEFAULT_DIFF_OPTIONS: DiffOptions = Object.freeze({
  attributes: {
    size: true,
    mtime: {
      enabled: true,
      toleranceSeconds: DEFAULT_MTIME_TOLERANCE_SECONDS,
      ignoreDstShift: false,
      ignoreTimezone: false,
    },
  },
  pairing: {
    caseSensitive: true,
    ignoreExtension: false,
    unicodeNormalize: true,
  },
  content: {
    mode: 'checksum',
    skipWhenAttributesMatch: true,
    overrideAttributesResult: true,
  },
}) as DiffOptions;

/**
 * Deep-merge a partial {@link DiffOptions} on top of {@link DEFAULT_DIFF_OPTIONS}.
 * Pure; returns a fresh object so callers can mutate safely.
 */
export function mergeDiffOptions(
  partial?: DeepPartial<DiffOptions> | null,
): DiffOptions {
  const base = DEFAULT_DIFF_OPTIONS;
  if (!partial) {
    return cloneDiffOptions(base);
  }
  return {
    attributes: {
      size: partial.attributes?.size ?? base.attributes.size,
      mtime: {
        enabled: partial.attributes?.mtime?.enabled ?? base.attributes.mtime.enabled,
        toleranceSeconds:
          partial.attributes?.mtime?.toleranceSeconds ?? base.attributes.mtime.toleranceSeconds,
        ignoreDstShift:
          partial.attributes?.mtime?.ignoreDstShift ?? base.attributes.mtime.ignoreDstShift,
        ignoreTimezone:
          partial.attributes?.mtime?.ignoreTimezone ?? base.attributes.mtime.ignoreTimezone,
      },
    },
    pairing: {
      caseSensitive: partial.pairing?.caseSensitive ?? base.pairing.caseSensitive,
      ignoreExtension: partial.pairing?.ignoreExtension ?? base.pairing.ignoreExtension,
      unicodeNormalize: partial.pairing?.unicodeNormalize ?? base.pairing.unicodeNormalize,
    },
    content: {
      mode: partial.content?.mode ?? base.content.mode,
      skipWhenAttributesMatch:
        partial.content?.skipWhenAttributesMatch ?? base.content.skipWhenAttributesMatch,
      overrideAttributesResult:
        partial.content?.overrideAttributesResult ?? base.content.overrideAttributesResult,
    },
  };
}

/**
 * Build a {@link DiffOptions} from a coarse {@link CompareMode} preset.
 * Lets old code paths that only know about `mode` keep working until
 * the full options surface is wired through everywhere.
 */
export function diffOptionsFromMode(mode: CompareMode): DiffOptions {
  const content: ContentCompareMode =
    mode === 'thorough' ? 'checksum' : mode === 'binary' ? 'binary' : 'off';
  return mergeDiffOptions({ content: { mode: content } });
}

/** Return a fresh, fully-independent copy of `o`. */
export function cloneDiffOptions(o: DiffOptions): DiffOptions {
  return {
    attributes: {
      size: o.attributes.size,
      mtime: { ...o.attributes.mtime },
    },
    pairing: { ...o.pairing },
    content: { ...o.content },
  };
}

/**
 * Decide whether two mtimes (epoch ms) are "equal" under the supplied
 * options. Pure; the source of truth for the DST / timezone semantics.
 *
 * Behaviour:
 * 1. If `mtime.enabled` is `false`, mtime is ignored — always equal.
 * 2. Otherwise compute `|delta|` in milliseconds.
 * 3. If `ignoreTimezone`, fold the delta into `[0, 1h)` (whole-hour
 *    offsets are erased).
 * 4. If `ignoreDstShift`, also accept deltas within `tolerance` of
 *    exactly one hour.
 * 5. Compare the (possibly folded) delta against the tolerance window.
 */
export function mtimeDeltaWithinTolerance(
  leftMs: number,
  rightMs: number,
  options: DiffOptions['attributes']['mtime'],
): boolean {
  if (!options.enabled) return true;
  const toleranceMs = Math.max(0, options.toleranceSeconds) * 1000;
  let delta = Math.abs(leftMs - rightMs);

  if (options.ignoreTimezone) {
    // Reduce to the smallest distance to a whole-hour boundary.
    const remainder = delta % ONE_HOUR_MS;
    delta = Math.min(remainder, ONE_HOUR_MS - remainder);
  }

  if (delta <= toleranceMs) return true;
  if (options.ignoreDstShift && Math.abs(delta - ONE_HOUR_MS) <= toleranceMs) return true;
  return false;
}

/** Recursive-partial helper limited to the depth we need. */
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
