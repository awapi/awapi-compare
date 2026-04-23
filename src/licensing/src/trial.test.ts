import { describe, expect, it } from 'vitest';
import { TRIAL_DURATION_DAYS, evaluateTrial } from './trial.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('evaluateTrial', () => {
  it('starts a new trial when no record exists', () => {
    const now = 1_700_000_000_000;
    const result = evaluateTrial(undefined, now);
    expect(result.record).toEqual({ startedAt: now, lastSeenAt: now });
    expect(result.status.state).toBe('trial');
    expect(result.status.trialDaysRemaining).toBe(TRIAL_DURATION_DAYS);
    expect(result.status.expiresAt).toBe(now + TRIAL_DURATION_DAYS * DAY_MS);
  });

  it('counts down remaining days during trial window', () => {
    const startedAt = 1_700_000_000_000;
    const now = startedAt + 3 * DAY_MS;
    const result = evaluateTrial({ startedAt, lastSeenAt: startedAt }, now);
    expect(result.status.state).toBe('trial');
    expect(result.status.trialDaysRemaining).toBe(TRIAL_DURATION_DAYS - 3);
  });

  it('expires when trial window is exhausted', () => {
    const startedAt = 1_700_000_000_000;
    const now = startedAt + (TRIAL_DURATION_DAYS + 1) * DAY_MS;
    const result = evaluateTrial({ startedAt, lastSeenAt: startedAt }, now);
    expect(result.status.state).toBe('expired');
    expect(result.status.trialDaysRemaining).toBe(0);
  });

  it('expires on significant clock rewind beyond tolerance', () => {
    const startedAt = 1_700_000_000_000;
    const lastSeenAt = startedAt + 2 * DAY_MS;
    // User rolled the clock back by 2 days.
    const now = lastSeenAt - 2 * DAY_MS;
    const result = evaluateTrial({ startedAt, lastSeenAt }, now);
    expect(result.status.state).toBe('expired');
  });

  it('tolerates small clock skew within the 6-hour window', () => {
    const startedAt = 1_700_000_000_000;
    const lastSeenAt = startedAt + 1 * DAY_MS;
    // Small backward skew of 1 hour.
    const now = lastSeenAt - 60 * 60 * 1000;
    const result = evaluateTrial({ startedAt, lastSeenAt }, now);
    expect(result.status.state).toBe('trial');
  });

  it('advances lastSeenAt monotonically', () => {
    const startedAt = 1_700_000_000_000;
    const lastSeenAt = startedAt + DAY_MS;
    const now = startedAt + 2 * DAY_MS;
    const result = evaluateTrial({ startedAt, lastSeenAt }, now);
    expect(result.record.lastSeenAt).toBe(now);
  });
});
