import { describe, expect, test } from 'vitest';

import {
  computeBackoffDelay,
  RETRY_BACKOFF_BASE_MS,
  RETRY_BACKOFF_MAX_MS,
} from './compute-backoff-delay.js';

describe('computeBackoffDelay', () => {
  test('doubles from the 5s base before the cap', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7].map((attempt) => computeBackoffDelay(attempt, () => 0.5));

    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000]);
  });

  test('is monotonic before the cap and plateaus at the cap with neutral jitter', () => {
    const neutral = (attempt: number) => computeBackoffDelay(attempt, () => 0.5);

    for (let attempt = 2; attempt <= 7; attempt += 1) {
      expect(neutral(attempt)).toBeGreaterThan(neutral(attempt - 1));
    }
    expect(neutral(7)).toBe(RETRY_BACKOFF_MAX_MS);
    expect(neutral(8)).toBe(RETRY_BACKOFF_MAX_MS);
    expect(neutral(20)).toBe(RETRY_BACKOFF_MAX_MS);
  });

  test('applies ±20% jitter around the exponential delay', () => {
    const attempt = 3;
    const exp = RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1);

    expect(computeBackoffDelay(attempt, () => 0)).toBe(Math.round(exp * 0.8));
    expect(computeBackoffDelay(attempt, () => 1)).toBe(Math.round(exp * 1.2));
    expect(computeBackoffDelay(attempt, () => 0.25)).toBe(Math.round(exp * 0.9));
    expect(computeBackoffDelay(attempt, () => 0.75)).toBe(Math.round(exp * 1.1));
  });

  test('stays within bounds at the cap and never returns a negative delay', () => {
    for (const attempt of [1, 2, 7, 8, 20]) {
      const neutral = computeBackoffDelay(attempt, () => 0.5);
      const minimum = computeBackoffDelay(attempt, () => 0);
      const maximum = computeBackoffDelay(attempt, () => 1);

      expect(minimum).toBeGreaterThanOrEqual(0);
      expect(minimum).toBeLessThanOrEqual(neutral);
      expect(maximum).toBeGreaterThanOrEqual(neutral);
      expect(maximum).toBeLessThanOrEqual(Math.round(RETRY_BACKOFF_MAX_MS * 1.2));
    }
  });

  test('uses Math.random by default', () => {
    const delay = computeBackoffDelay(1);

    expect(delay).toBeGreaterThanOrEqual(Math.round(RETRY_BACKOFF_BASE_MS * 0.8));
    expect(delay).toBeLessThanOrEqual(Math.round(RETRY_BACKOFF_BASE_MS * 1.2));
  });
});
