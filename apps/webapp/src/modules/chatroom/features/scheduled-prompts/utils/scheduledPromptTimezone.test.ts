import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  formatDailyScheduleLocal,
  formatTimezoneLabel,
  getBrowserTimezone,
  localDailyTimeToUtc,
  utcDailyTimeToLocal,
} from './scheduledPromptTimezone';

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
    vi.stubGlobal(
      'Intl',
      new Proxy(Intl, {
        get(target, prop) {
          if (prop === 'DateTimeFormat') {
            return class extends target.DateTimeFormat {
              resolvedOptions() {
                return { ...super.resolvedOptions(), timeZone: 'UTC' };
              }
            };
          }
          return Reflect.get(target, prop);
        },
      })
    );
    const utc = localDailyTimeToUtc(9, 30);
    expect(utc).toEqual({ hourUTC: 9, minuteUTC: 30 });
    const local = utcDailyTimeToLocal(9, 30);
    expect(local).toEqual({ hour: 9, minute: 30 });
  });

  it('formatDailyScheduleLocal shows local time with timezone', () => {
    const result = formatDailyScheduleLocal(9, 0);
    expect(result).toMatch(/^Daily at \d{2}:\d{2} \(/);
  });
});
