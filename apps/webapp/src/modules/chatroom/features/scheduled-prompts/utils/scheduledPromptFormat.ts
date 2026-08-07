import { formatDailyScheduleLocal, formatTimestampLocal } from './scheduledPromptTimezone';

function formatIntervalSchedule(intervalMinutes: number): string {
  if (intervalMinutes === 1) return 'Every minute';
  return `Every ${intervalMinutes} minutes`;
}

export function formatSchedule(prompt: {
  scheduleKind: 'interval' | 'daily';
  intervalMinutes?: number;
  hourUTC?: number;
  minuteUTC?: number;
}): string {
  if (prompt.scheduleKind === 'interval') {
    return formatIntervalSchedule(prompt.intervalMinutes ?? 1);
  }
  return formatDailyScheduleLocal(prompt.hourUTC ?? 0, prompt.minuteUTC ?? 0);
}

export function formatTime(ts: number): string {
  return formatTimestampLocal(ts);
}
