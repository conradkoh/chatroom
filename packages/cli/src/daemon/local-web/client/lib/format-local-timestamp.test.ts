import { describe, expect, it } from 'vitest';

import { formatLocalLogDateTime, formatLocalLogTime } from './format-local-timestamp';

describe('format-local-timestamp', () => {
  // 2024-06-15T14:30:45.000Z
  const timestamp = Date.UTC(2024, 5, 15, 14, 30, 45);

  it('formats a 24-hour clock in the given timezone', () => {
    expect(formatLocalLogTime(timestamp, { timeZone: 'Asia/Singapore' })).toBe('22:30:45');
    expect(formatLocalLogTime(timestamp, { timeZone: 'America/New_York' })).toBe('10:30:45');
  });

  it('respects the UTC timezone', () => {
    expect(formatLocalLogTime(timestamp, { timeZone: 'UTC' })).toBe('14:30:45');
  });

  it('formats full date-time in the given timezone', () => {
    const singapore = formatLocalLogDateTime(timestamp, { timeZone: 'Asia/Singapore' });
    expect(singapore).toContain('2024');
    expect(singapore).not.toContain('14:30');
  });
});
