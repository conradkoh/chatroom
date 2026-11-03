import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';

import {
  formatSchedule,
  formatScheduledPromptStatus,
  formatUpcomingRun,
  getScheduledPromptStatus,
  isFinishedScheduledPromptStatus,
  scheduledPromptActionErrorMessage,
  type ScheduledPromptStatus,
} from './scheduledPromptFormat';

// Pin the timezone so the formatted timestamp literals are stable everywhere.
beforeAll(() => {
  vi.stubEnv('TZ', 'UTC');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

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
      'Once on 3rd November 2026, 9:05am'
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

describe('formatUpcomingRun', () => {
  it('labels a same-local-day run with the time only', () => {
    const now = new Date(2026, 10, 3, 9, 0).getTime();
    const ts = new Date(2026, 10, 3, 14, 30).getTime();
    expect(formatUpcomingRun(ts, now)).toBe('Today 14:30');
  });

  it('labels the next local day as Tomorrow', () => {
    const now = new Date(2026, 10, 3, 23, 0).getTime();
    const ts = new Date(2026, 10, 4, 9, 0).getTime();
    expect(formatUpcomingRun(ts, now)).toBe('Tomorrow 09:00');
  });

  it('labels a later day with the month and day across a month boundary', () => {
    const now = new Date(2026, 9, 31, 12, 0).getTime();
    const ts = new Date(2026, 10, 5, 17, 0).getTime();
    expect(formatUpcomingRun(ts, now)).toBe('Nov 5 17:00');
  });
});

describe('scheduledPromptActionErrorMessage', () => {
  const fallback = 'Could not update the schedule. Try again.';
  const convexError = (code: string) => ({ data: { code, message: 'ignored' } });

  it('maps SCHEDULE_FINISHED', () => {
    expect(scheduledPromptActionErrorMessage(convexError('SCHEDULE_FINISHED'), fallback)).toBe(
      'This prompt has already run.'
    );
  });

  it('maps LIFECYCLE_DISABLED', () => {
    expect(scheduledPromptActionErrorMessage(convexError('LIFECYCLE_DISABLED'), fallback)).toBe(
      "This prompt is archived and can't be changed."
    );
  });

  it('maps NOT_FOUND', () => {
    expect(scheduledPromptActionErrorMessage(convexError('NOT_FOUND'), fallback)).toBe(
      'This prompt was deleted.'
    );
  });

  it('falls back for an unknown code', () => {
    expect(scheduledPromptActionErrorMessage(convexError('NOTHING_TO_UPDATE'), fallback)).toBe(
      fallback
    );
  });

  it('falls back for a plain Error', () => {
    expect(scheduledPromptActionErrorMessage(new Error('boom'), fallback)).toBe(fallback);
  });

  it('falls back for a non-error value', () => {
    expect(scheduledPromptActionErrorMessage(null, fallback)).toBe(fallback);
  });
});
