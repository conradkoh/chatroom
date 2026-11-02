import { describe, it, expect } from 'vitest';

import {
  formatSchedule,
  formatScheduledPromptStatus,
  getScheduledPromptStatus,
  isFinishedScheduledPromptStatus,
  type ScheduledPromptStatus,
} from './scheduledPromptFormat';
import { formatTimestampFull } from '../../../utils/chatroomTimestamp';

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

describe('formatSchedule one-time', () => {
  const T = Date.UTC(2026, 10, 3, 9, 5);

  it('formats a one-time schedule with the full local timestamp', () => {
    expect(formatSchedule({ scheduleKind: 'once', runAt: T })).toBe(
      `Once on ${formatTimestampFull(T)}`
    );
  });

  it('falls back to a bare label when runAt is missing', () => {
    expect(formatSchedule({ scheduleKind: 'once' })).toBe('Once');
  });
});

describe('getScheduledPromptStatus', () => {
  it('maps disabledReason to a status', () => {
    expect(getScheduledPromptStatus({})).toBe('active');
    expect(getScheduledPromptStatus({ disabledReason: undefined })).toBe('active');
    expect(getScheduledPromptStatus({ disabledReason: 'user' })).toBe('disabled');
    expect(getScheduledPromptStatus({ disabledReason: 'archive' })).toBe('archived');
    expect(getScheduledPromptStatus({ disabledReason: 'completed' })).toBe('completed');
    expect(getScheduledPromptStatus({ disabledReason: 'failed' })).toBe('failed');
  });
});

describe('formatScheduledPromptStatus', () => {
  it('maps every status to its display label', () => {
    expect(formatScheduledPromptStatus('active')).toBe('Active');
    expect(formatScheduledPromptStatus('disabled')).toBe('Disabled');
    expect(formatScheduledPromptStatus('archived')).toBe('Disabled by archive');
    expect(formatScheduledPromptStatus('completed')).toBe('Completed');
    expect(formatScheduledPromptStatus('failed')).toBe('Failed');
  });
});

describe('isFinishedScheduledPromptStatus', () => {
  it('is true only for completed and failed', () => {
    const statuses: ScheduledPromptStatus[] = [
      'active',
      'disabled',
      'archived',
      'completed',
      'failed',
    ];
    expect(statuses.filter(isFinishedScheduledPromptStatus)).toEqual(['completed', 'failed']);
  });
});
