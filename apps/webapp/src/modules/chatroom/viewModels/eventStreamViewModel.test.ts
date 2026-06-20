import { describe, expect, it } from 'vitest';

import { formatTimestamp, formatTimestampFull } from './eventStreamViewModel';

describe('formatTimestamp', () => {
  it('includes date and time', () => {
    // 2026-06-20 13:45:30 UTC — use fixed timestamp
    const ms = Date.UTC(2026, 5, 20, 13, 45, 30);
    const result = formatTimestamp(ms);
    // Should contain date portion (06/20) and time portion (13:45:30 or local equivalent)
    expect(result).toMatch(/\d{2}\/\d{2}/);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('differs from formatTimestampFull (no year in short format)', () => {
    const ms = Date.UTC(2026, 5, 20, 13, 45, 30);
    const short = formatTimestamp(ms);
    const full = formatTimestampFull(ms);
    expect(full).toContain('2026');
    expect(short).not.toContain('2026');
  });
});
