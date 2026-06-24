import { describe, expect, it } from 'vitest';

import { formatTimestamp, formatTimestampFull } from './eventStreamViewModel';

describe('formatTimestamp', () => {
  const currentYearMs = new Date(2026, 5, 12, 22, 0, 0).getTime();
  const priorYearMs = new Date(2025, 5, 12, 22, 0, 0).getTime();

  it('formats current-year messages without year', () => {
    expect(formatTimestamp(currentYearMs)).toBe('12th June, 10:00pm');
  });

  it('formats prior-year messages with year', () => {
    expect(formatTimestamp(priorYearMs)).toBe('12th June 2025, 10:00pm');
  });

  it('formatTimestampFull always includes year', () => {
    expect(formatTimestampFull(currentYearMs)).toBe('12th June 2026, 10:00pm');
    expect(formatTimestampFull(priorYearMs)).toBe('12th June 2025, 10:00pm');
  });
});
