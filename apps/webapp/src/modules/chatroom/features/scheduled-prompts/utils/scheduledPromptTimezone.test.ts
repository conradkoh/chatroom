import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  formatDailyScheduleLocal,
  formatTimezoneLabel,
  getBrowserTimezone,
  localDailyTimeToUtc,
  localDateTimeInputToUtcMs,
  utcDailyTimeToLocal,
  utcMsToLocalDateTimeInput,
} from './scheduledPromptTimezone';

describe('scheduledPromptTimezone', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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
    vi.stubEnv('TZ', 'UTC');
    const utc = localDailyTimeToUtc(9, 30);
    expect(utc).toEqual({ hourUTC: 9, minuteUTC: 30 });
    const local = utcDailyTimeToLocal(9, 30);
    expect(local).toEqual({ hour: 9, minute: 30 });
  });

  it('formatDailyScheduleLocal shows local time without timezone suffix', () => {
    vi.stubEnv('TZ', 'UTC');
    const result = formatDailyScheduleLocal(9, 0);
    expect(result).toBe('Daily at 09:00');
  });

  it('localDateTimeInputToUtcMs parses a datetime-local value in local time', () => {
    expect(localDateTimeInputToUtcMs('2026-11-03T09:05')).toBe(
      new Date(2026, 10, 3, 9, 5).getTime()
    );
  });

  it('localDateTimeInputToUtcMs parses seconds and keeps them', () => {
    expect(localDateTimeInputToUtcMs('2026-11-03T09:05:30')).toBe(
      new Date(2026, 10, 3, 9, 5, 30).getTime()
    );
  });

  it('localDateTimeInputToUtcMs returns undefined for empty or invalid input', () => {
    expect(localDateTimeInputToUtcMs('')).toBeUndefined();
    expect(localDateTimeInputToUtcMs('garbage')).toBeUndefined();
  });

  it('utcMsToLocalDateTimeInput round-trips a datetime-local value', () => {
    expect(utcMsToLocalDateTimeInput(localDateTimeInputToUtcMs('2026-11-03T09:05')!)).toBe(
      '2026-11-03T09:05'
    );
  });
});
