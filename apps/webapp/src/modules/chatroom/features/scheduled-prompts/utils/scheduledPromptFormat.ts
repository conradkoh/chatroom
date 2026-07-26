import { formatDailyScheduleLocal, formatTimestampLocal } from './scheduledPromptTimezone';

export function formatSchedule(prompt: {
  scheduleKind: 'interval' | 'daily';
  intervalMinutes?: number;
  hourUTC?: number;
  minuteUTC?: number;
}): string {
  if (prompt.scheduleKind === 'interval') return `Every ${prompt.intervalMinutes} minutes`;
  return formatDailyScheduleLocal(prompt.hourUTC ?? 0, prompt.minuteUTC ?? 0);
}

export function formatTime(ts: number): string {
  return formatTimestampLocal(ts);
}
