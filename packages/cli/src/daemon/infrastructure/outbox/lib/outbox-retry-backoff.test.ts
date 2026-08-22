import { describe, expect, it } from 'vitest';

import { computeExponentialRetryDelayMs } from './outbox-retry-backoff.js';

describe('computeExponentialRetryDelayMs', () => {
  it('doubles per attempt until the max delay', () => {
    expect(computeExponentialRetryDelayMs(0, 5_000, 300_000)).toBe(5_000);
    expect(computeExponentialRetryDelayMs(1, 5_000, 300_000)).toBe(10_000);
    expect(computeExponentialRetryDelayMs(2, 5_000, 300_000)).toBe(20_000);
    expect(computeExponentialRetryDelayMs(6, 5_000, 300_000)).toBe(300_000);
    expect(computeExponentialRetryDelayMs(40, 5_000, 300_000)).toBe(300_000);
  });
});
