/** Recurring schedules are the only kinds with computable next-run maths. */
export type RecurringScheduledPromptSchedule =
  | { scheduleKind: 'interval'; intervalMinutes: number }
  | { scheduleKind: 'daily'; hourUTC: number; minuteUTC: number };

/** A one-time schedule carries the absolute time the user chose. */
export type ScheduledPromptSchedule =
  RecurringScheduledPromptSchedule | { scheduleKind: 'once'; runAt: number };

/**
 * Compute the next run for a recurring schedule.
 * One-time schedules have no recurrence: their trigger time is `runAt` itself,
 * so they are excluded from the parameter type.
 */
export function computeNextRunAt(
  schedule: RecurringScheduledPromptSchedule,
  fromMs: number,
  previousScheduledAt?: number
): number {
  switch (schedule.scheduleKind) {
    case 'interval': {
      const intervalMs = schedule.intervalMinutes * 60_000;
      if (previousScheduledAt === undefined) {
        return fromMs + intervalMs;
      }
      let next = previousScheduledAt + intervalMs;
      while (next < fromMs) {
        next += intervalMs;
      }
      return next;
    }
    case 'daily': {
      const base = new Date(fromMs);
      const candidate = Date.UTC(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        base.getUTCDate(),
        schedule.hourUTC,
        schedule.minuteUTC,
        0,
        0
      );
      return candidate > fromMs ? candidate : candidate + 24 * 60 * 60_000;
    }
    default: {
      const never: never = schedule;
      throw new Error(`Unknown scheduleKind ${String(never)}`);
    }
  }
}

/** Ceil a timestamp to the next whole-minute boundary (UTC). Exact minute boundaries are unchanged. */
export function ceilToNextMinute(ms: number): number {
  return Math.ceil(ms / 60_000) * 60_000;
}

/**
 * Compute nextRunAt for create/enable/schedule-change.
 * Ceils now to the next minute before scheduling so the first fire aligns with cron granularity.
 * Callers validate that a `once` runAt is in the future before calling.
 */
export function computeNextRunAtForEnable(
  schedule: ScheduledPromptSchedule,
  nowMs: number,
  previousScheduledAt?: number
): number {
  if (schedule.scheduleKind === 'once') return schedule.runAt;
  const fromMs = ceilToNextMinute(nowMs);
  const next = computeNextRunAt(schedule, fromMs, previousScheduledAt);
  return Math.max(next, fromMs);
}
