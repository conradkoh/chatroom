import { describe, it, expect } from 'vitest';

import { formatSchedule } from './scheduledPromptFormat';

describe('formatSchedule', () => {
  it('uses singular for 1 minute interval', () => {
    expect(formatSchedule({ scheduleKind: 'interval', intervalMinutes: 1 })).toBe('Every minute');
  });
  it('uses plural for multiple minutes', () => {
    expect(formatSchedule({ scheduleKind: 'interval', intervalMinutes: 30 })).toBe(
      'Every 30 minutes'
    );
  });
});
