import { describe, expect, it } from 'vitest';

import { formatTimestamp, formatTimestampFull } from './chatroomTimestamp';

describe('formatTimestamp', () => {
  it('formats timestamps', () => {
    const current = new Date('2026-06-12T22:00:00').getTime();
    expect(formatTimestamp(current)).toBe('12th June, 10:00pm');
    expect(formatTimestampFull(current)).toBe('12th June 2026, 10:00pm');
  });
});
