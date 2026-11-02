import { describe, expect, it } from 'vitest';

import { formatTimeOfDay, formatTimestamp, formatTimestampFull } from './chatroomTimestamp';

describe('formatTimestamp', () => {
  it('formats timestamps', () => {
    const current = new Date('2026-06-12T22:00:00').getTime();
    expect(formatTimestamp(current)).toBe('12th June, 10:00pm');
    expect(formatTimestampFull(current)).toBe('12th June 2026, 10:00pm');
  });
});

describe('formatTimeOfDay', () => {
  it('formats a time of day without the date', () => {
    const at = Date.UTC(2023, 10, 15, 12, 14, 22);

    expect(formatTimeOfDay(at)).toMatch(/^\d{1,2}:\d{2}(am|pm)$/);
  });

  it('matches the time part of the full timestamp', () => {
    const at = Date.UTC(2023, 10, 15, 12, 14, 22);

    expect(formatTimeOfDay(at)).toBe(formatTimestampFull(at).split(', ').at(-1));
  });
});
