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
