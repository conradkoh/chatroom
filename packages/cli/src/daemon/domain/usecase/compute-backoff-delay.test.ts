import { describe, expect, test } from 'vitest';

import {
  computeBackoffDelay,
  REDELIVERY_BACKOFF_OPTIONS,
  type BackoffOptions,
} from './compute-backoff-delay.js';

const DETERMINISTIC: BackoffOptions = { baseMs: 1_000, maxMs: 30_000, jitter: 0 };
const RANDOMS = [0, 0.25, 0.5, 0.75, 1];

describe('computeBackoffDelay', () => {
  test('doubles from the 5s base and plateaus at the capped neutral value', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7].map((attempt) =>
      computeBackoffDelay(attempt, REDELIVERY_BACKOFF_OPTIONS, () => 0.5)
    );

    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 54_000, 54_000, 54_000]);
  });

  test('is strictly increasing before the cap and plateaus at 54s from attempt 5 with neutral jitter', () => {
    const neutral = (attempt: number) =>
      computeBackoffDelay(attempt, REDELIVERY_BACKOFF_OPTIONS, () => 0.5);

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      expect(neutral(attempt)).toBeGreaterThan(neutral(attempt - 1));
    }
    expect(neutral(5)).toBe(54_000);
    expect(neutral(6)).toBe(54_000);
    expect(neutral(20)).toBe(54_000);
  });

  test('applies ±20% jitter below the cap', () => {
    expect(computeBackoffDelay(3, REDELIVERY_BACKOFF_OPTIONS, () => 0)).toBe(16_000);
    expect(computeBackoffDelay(3, REDELIVERY_BACKOFF_OPTIONS, () => 1)).toBe(24_000);
    expect(computeBackoffDelay(3, REDELIVERY_BACKOFF_OPTIONS, () => 0.25)).toBe(18_000);
    expect(computeBackoffDelay(3, REDELIVERY_BACKOFF_OPTIONS, () => 0.75)).toBe(22_000);
    expect(computeBackoffDelay(4, REDELIVERY_BACKOFF_OPTIONS, () => 0)).toBe(32_000);
    expect(computeBackoffDelay(4, REDELIVERY_BACKOFF_OPTIONS, () => 1)).toBe(48_000);
  });

  test('jitters downward only at the cap', () => {
    expect(computeBackoffDelay(20, REDELIVERY_BACKOFF_OPTIONS, () => 0)).toBe(60_000);
    expect(computeBackoffDelay(20, REDELIVERY_BACKOFF_OPTIONS, () => 0.5)).toBe(54_000);
    expect(computeBackoffDelay(20, REDELIVERY_BACKOFF_OPTIONS, () => 1)).toBe(48_000);
    expect(computeBackoffDelay(5, REDELIVERY_BACKOFF_OPTIONS, () => 0)).toBe(60_000);
    expect(computeBackoffDelay(5, REDELIVERY_BACKOFF_OPTIONS, () => 1)).toBe(48_000);
  });

  test('stays within [48s, 60s] for every capped attempt and jitter value', () => {
    for (const attempt of [5, 6, 7, 8, 20]) {
      for (const random of RANDOMS) {
        const delay = computeBackoffDelay(attempt, REDELIVERY_BACKOFF_OPTIONS, () => random);
        expect(delay).toBeGreaterThanOrEqual(48_000);
        expect(delay).toBeLessThanOrEqual(60_000);
      }
    }
  });

  test('never returns a negative delay or one above 60s for any attempt', () => {
    for (let attempt = 1; attempt <= 25; attempt += 1) {
      for (const random of RANDOMS) {
        const delay = computeBackoffDelay(attempt, REDELIVERY_BACKOFF_OPTIONS, () => random);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(60_000);
      }
    }
  });

  test('disables jitter when the ratio is omitted or zero', () => {
    expect(computeBackoffDelay(1, { baseMs: 1_000, maxMs: 30_000 })).toBe(1_000);
    expect(computeBackoffDelay(5, DETERMINISTIC)).toBe(16_000);
    expect(computeBackoffDelay(9, DETERMINISTIC)).toBe(30_000);
    expect(computeBackoffDelay(20, DETERMINISTIC)).toBe(30_000);
  });

  test('uses Math.random by default', () => {
    const delay = computeBackoffDelay(1, REDELIVERY_BACKOFF_OPTIONS);

    expect(delay).toBeGreaterThanOrEqual(Math.round(REDELIVERY_BACKOFF_OPTIONS.baseMs * 0.8));
    expect(delay).toBeLessThanOrEqual(Math.round(REDELIVERY_BACKOFF_OPTIONS.baseMs * 1.2));
  });
});
