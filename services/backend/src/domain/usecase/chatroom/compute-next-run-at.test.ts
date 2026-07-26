import { describe, expect, test } from 'vitest';

import { computeNextRunAt } from './compute-next-run-at';

describe('computeNextRunAt', () => {
  test('interval 5min from t=1000 returns 301000', () => {
    expect(computeNextRunAt({ scheduleKind: 'interval', intervalMinutes: 5 }, 1000)).toBe(301000);
  });

  test('daily at 14:30 UTC when now is 14:29 returns today 14:30', () => {
    const now = Date.UTC(2026, 0, 15, 14, 29, 0, 0);
    const expected = Date.UTC(2026, 0, 15, 14, 30, 0, 0);
    expect(computeNextRunAt({ scheduleKind: 'daily', hourUTC: 14, minuteUTC: 30 }, now)).toBe(
      expected
    );
  });

  test('daily at 14:30 UTC when now is exactly 14:30 returns tomorrow 14:30', () => {
    const now = Date.UTC(2026, 0, 15, 14, 30, 0, 0);
    const expected = Date.UTC(2026, 0, 16, 14, 30, 0, 0);
    expect(computeNextRunAt({ scheduleKind: 'daily', hourUTC: 14, minuteUTC: 30 }, now)).toBe(
      expected
    );
  });

  test('daily at 14:30 UTC when now is 15:00 returns tomorrow 14:30', () => {
    const now = Date.UTC(2026, 0, 15, 15, 0, 0, 0);
    const expected = Date.UTC(2026, 0, 16, 14, 30, 0, 0);
    expect(computeNextRunAt({ scheduleKind: 'daily', hourUTC: 14, minuteUTC: 30 }, now)).toBe(
      expected
    );
  });
});
