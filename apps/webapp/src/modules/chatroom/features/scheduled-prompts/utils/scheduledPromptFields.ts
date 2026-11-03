import type { ScheduledPromptScheduleKind } from './scheduledPromptFormat';
import { localDailyTimeToUtc, localDateTimeInputToUtcMs } from './scheduledPromptTimezone';

/** The schedule-kind-specific part of a scheduled prompt form submission. */
export type ScheduleFields = {
  scheduleKind: ScheduledPromptScheduleKind;
  intervalMinutes?: number;
  hourUTC?: number;
  minuteUTC?: number;
  runAt?: number;
};

export interface ScheduleFieldInput {
  runAtLocal: string;
  intervalMinutes: number;
  hour: number;
  minute: number;
  now: number;
  /** Stored runAt of the edited row; undefined when creating or not a once row. */
  initialRunAt?: number;
}

export type ScheduleFieldResult = { data: ScheduleFields } | { error: string };

function buildIntervalFields(input: ScheduleFieldInput): ScheduleFieldResult {
  if (!input.intervalMinutes || input.intervalMinutes < 1) {
    return { error: 'Interval must be at least 1 minute' };
  }
  return { data: { scheduleKind: 'interval', intervalMinutes: input.intervalMinutes } };
}

function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function buildDailyFields(input: ScheduleFieldInput): ScheduleFieldResult {
  const { hour, minute } = input;
  if (!isInRange(hour, 0, 23) || !isInRange(minute, 0, 59)) {
    return { error: 'Daily schedule requires valid hour (0-23) and minute (0-59)' };
  }
  const { hourUTC, minuteUTC } = localDailyTimeToUtc(hour, minute, new Date(input.now));
  return { data: { scheduleKind: 'daily', hourUTC, minuteUTC } };
}

/** Minute precision: the form input has no seconds. */
function isUnchangedRunAt(runAt: number, initialRunAt: number | undefined): boolean {
  return (
    initialRunAt !== undefined && Math.floor(runAt / 60_000) === Math.floor(initialRunAt / 60_000)
  );
}

function buildOnceFields(input: ScheduleFieldInput): ScheduleFieldResult {
  const runAt = localDateTimeInputToUtcMs(input.runAtLocal);
  if (runAt === undefined) {
    return { error: 'Pick a date and time' };
  }
  // An unchanged time is not re-checked, so a past-due row can still be renamed
  // before the cron fires it (the backend skips re-validation the same way).
  if (!isUnchangedRunAt(runAt, input.initialRunAt) && runAt <= input.now) {
    return { error: 'Pick a time in the future' };
  }
  return { data: { scheduleKind: 'once', runAt } };
}

/**
 * Validate the schedule-kind-specific fields of a form submission and build the
 * payload. Pure, so the form only owns input state and error display.
 */
export function buildScheduleFields(
  kind: ScheduleFields['scheduleKind'],
  input: ScheduleFieldInput
): ScheduleFieldResult {
  switch (kind) {
    case 'interval':
      return buildIntervalFields(input);
    case 'daily':
      return buildDailyFields(input);
    case 'once':
      return buildOnceFields(input);
  }
}
