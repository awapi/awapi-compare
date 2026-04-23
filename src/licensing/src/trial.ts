import type { LicenseStatus } from '@awapi/shared';

export const TRIAL_DURATION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Tolerance for clock skew, in ms (user pushing clock back by a few hours). */
const CLOCK_SKEW_TOLERANCE_MS = 6 * 60 * 60 * 1000;

export interface TrialRecord {
  /** Epoch ms when trial was first started (earliest observed install time). */
  startedAt: number;
  /** Highest timestamp we've ever observed; guards against clock rewind. */
  lastSeenAt: number;
}

export interface TrialEvaluation {
  record: TrialRecord;
  status: LicenseStatus;
}

/**
 * Evaluate a trial record against the current time.
 *
 * - If `record` is undefined, a new trial starts now.
 * - If the system clock is earlier than `lastSeenAt` (minus tolerance), we
 *   treat the clock as tampered and expire the trial immediately.
 * - Otherwise, trial remains active until `startedAt + TRIAL_DURATION_DAYS`.
 */
export function evaluateTrial(record: TrialRecord | undefined, now: number): TrialEvaluation {
  if (!record) {
    const fresh: TrialRecord = { startedAt: now, lastSeenAt: now };
    return {
      record: fresh,
      status: {
        state: 'trial',
        trialDaysRemaining: TRIAL_DURATION_DAYS,
        expiresAt: now + TRIAL_DURATION_DAYS * DAY_MS,
      },
    };
  }

  // Clock-rewind guard.
  if (now + CLOCK_SKEW_TOLERANCE_MS < record.lastSeenAt) {
    return {
      record,
      status: { state: 'expired', trialDaysRemaining: 0, expiresAt: record.lastSeenAt },
    };
  }

  const expiresAt = record.startedAt + TRIAL_DURATION_DAYS * DAY_MS;
  const updated: TrialRecord = {
    startedAt: record.startedAt,
    lastSeenAt: Math.max(record.lastSeenAt, now),
  };

  if (now >= expiresAt) {
    return { record: updated, status: { state: 'expired', trialDaysRemaining: 0, expiresAt } };
  }

  const remainingMs = expiresAt - now;
  return {
    record: updated,
    status: {
      state: 'trial',
      trialDaysRemaining: Math.ceil(remainingMs / DAY_MS),
      expiresAt,
    },
  };
}
