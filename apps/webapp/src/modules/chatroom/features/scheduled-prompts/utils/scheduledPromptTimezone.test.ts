import { afterAll, afterEach, beforeAll, describe, it, expect, vi } from 'vitest';

import {
  formatDailyScheduleLocal,
  formatTimezoneLabel,
  getBrowserTimezone,
  localDailyTimeToUtc,
  localDateTimeInputToUtcMs,
  utcDailyTimeToLocal,
  utcMsToLocalDateTimeInput,
} from './scheduledPromptTimezone';

// Pin the timezone so the parsed epoch literals are stable everywhere.
beforeAll(() => {
  vi.stubEnv('TZ', 'UTC');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe('scheduledPromptTimezone', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getBrowserTimezone returns IANA timezone', () => {
    expect(getBrowserTimezone()).toBeTruthy();
    expect(typeof getBrowserTimezone()).toBe('string');
  });

  it('formatTimezoneLabel includes IANA name', () => {
    const label = formatTimezoneLabel('UTC');
    expect(label).toContain('UTC');
  });

  it('localDailyTimeToUtc and utcDailyTimeToLocal round-trip in UTC', () => {
    const utc = localDailyTimeToUtc(9, 30);
    expect(utc).toEqual({ hourUTC: 9, minuteUTC: 30 });
    const local = utcDailyTimeToLocal(9, 30);
    expect(local).toEqual({ hour: 9, minute: 30 });
  });

  it('formatDailyScheduleLocal shows local time without timezone suffix', () => {
    const result = formatDailyScheduleLocal(9, 0);
    expect(result).toBe('Daily at 09:00');
  });

  it('localDateTimeInputToUtcMs parses a datetime-local value in local time', () => {
    expect(localDateTimeInputToUtcMs('2026-11-03T09:05')).toBe(1793696700000);
  });

  it('localDateTimeInputToUtcMs parses seconds and keeps them', () => {
    expect(localDateTimeInputToUtcMs('2026-11-03T09:05:30')).toBe(1793696730000);
  });

  it('localDateTimeInputToUtcMs returns undefined for empty or invalid input', () => {
    expect(localDateTimeInputToUtcMs('')).toBeUndefined();
    expect(localDateTimeInputToUtcMs('garbage')).toBeUndefined();
  });

  it('utcMsToLocalDateTimeInput formats a fixed epoch as a datetime-local value', () => {
    expect(utcMsToLocalDateTimeInput(1793696700000)).toBe('2026-11-03T09:05');
  });
});
