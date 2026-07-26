export type ScheduledPromptSchedule =
  | { scheduleKind: 'interval'; intervalMinutes: number }
  | { scheduleKind: 'daily'; hourUTC: number; minuteUTC: number };

export function computeNextRunAt(
  schedule: ScheduledPromptSchedule,
  fromMs: number,
  previousScheduledAt?: number
): number {
  if (schedule.scheduleKind === 'interval') {
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

/** Ceil a timestamp to the next whole-minute boundary (UTC). Exact minute boundaries are unchanged. */
export function ceilToNextMinute(ms: number): number {
  return Math.ceil(ms / 60_000) * 60_000;
}

/**
 * Compute nextRunAt for create/enable/schedule-change.
 * Ceils now to the next minute before scheduling so the first fire aligns with cron granularity.
 */
export function computeNextRunAtForEnable(
  schedule: ScheduledPromptSchedule,
  nowMs: number,
  previousScheduledAt?: number
): number {
  const fromMs = ceilToNextMinute(nowMs);
  const next = computeNextRunAt(schedule, fromMs, previousScheduledAt);
  return Math.max(next, fromMs);
}
