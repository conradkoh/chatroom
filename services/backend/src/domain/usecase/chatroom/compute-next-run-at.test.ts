import { describe, expect, test } from 'vitest';

import {
  ceilToNextMinute,
  computeNextRunAt,
  computeNextRunAtForEnable,
} from './compute-next-run-at';

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

  test('interval 1min with anchor preserves cadence when execution is late', () => {
    const scheduledAt = 60_000;
    const executedAt = 62_000;
    expect(
      computeNextRunAt({ scheduleKind: 'interval', intervalMinutes: 1 }, executedAt, scheduledAt)
    ).toBe(120_000);
  });

  test('interval catches up when multiple ticks missed', () => {
    const scheduledAt = 60_000;
    const executedAt = 240_000;
    expect(
      computeNextRunAt({ scheduleKind: 'interval', intervalMinutes: 1 }, executedAt, scheduledAt)
    ).toBe(240_000);
  });

  test('interval without anchor still uses fromMs + interval', () => {
    expect(computeNextRunAt({ scheduleKind: 'interval', intervalMinutes: 1 }, 50_000)).toBe(
      110_000
    );
  });

  test('ceilToNextMinute rounds up sub-minute timestamps', () => {
    expect(ceilToNextMinute(60_000 + 20_000)).toBe(120_000); // :20s → next minute
    expect(ceilToNextMinute(60_000)).toBe(60_000); // exact boundary unchanged
  });

  test('computeNextRunAtForEnable never returns before ceiled now', () => {
    const now = Date.UTC(2026, 0, 15, 14, 30, 20, 0); // 14:30:20
    const ceiled = Date.UTC(2026, 0, 15, 14, 31, 0, 0);
    const result = computeNextRunAtForEnable(
      { scheduleKind: 'daily', hourUTC: 14, minuteUTC: 30 },
      now
    );
    expect(result).toBeGreaterThanOrEqual(ceiled);
  });

  test('computeNextRunAtForEnable interval bumps cadence slot before ceiled now', () => {
    const now = Date.UTC(2026, 0, 15, 14, 30, 20, 0);
    const lastRunAt = Date.UTC(2026, 0, 15, 14, 29, 0, 0);
    const ceiled = Date.UTC(2026, 0, 15, 14, 31, 0, 0);
    const result = computeNextRunAtForEnable(
      { scheduleKind: 'interval', intervalMinutes: 1 },
      now,
      lastRunAt
    );
    expect(result).toBe(ceiled);
  });
});
