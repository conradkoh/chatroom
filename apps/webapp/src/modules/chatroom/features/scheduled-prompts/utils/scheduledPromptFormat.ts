import { formatDailyScheduleLocal, formatTimestampLocal } from './scheduledPromptTimezone';
import { formatTimestampFull } from '../../../utils/chatroomTimestamp';

type ScheduledPromptScheduleKind = 'interval' | 'daily' | 'once';
type ScheduledPromptDisabledReason = 'user' | 'archive' | 'completed' | 'failed';

/** Derived display status for a scheduled prompt row. */
export type ScheduledPromptStatus = 'active' | 'disabled' | 'archived' | 'completed' | 'failed';

function formatIntervalSchedule(intervalMinutes: number): string {
  if (intervalMinutes === 1) return 'Every minute';
  return `Every ${intervalMinutes} minutes`;
}

// Exhaustive per-kind switch: every schedule kind gets its own branch.
// fallow-ignore-next-line complexity
export function formatSchedule(prompt: {
  scheduleKind: ScheduledPromptScheduleKind;
  intervalMinutes?: number;
  hourUTC?: number;
  minuteUTC?: number;
  runAt?: number;
}): string {
  switch (prompt.scheduleKind) {
    case 'interval':
      return formatIntervalSchedule(prompt.intervalMinutes ?? 1);
    case 'daily':
      return formatDailyScheduleLocal(prompt.hourUTC ?? 0, prompt.minuteUTC ?? 0);
    case 'once':
      return prompt.runAt !== undefined ? `Once on ${formatTimestampFull(prompt.runAt)}` : 'Once';
  }
}

export function formatTime(ts: number): string {
  return formatTimestampLocal(ts);
}

/** The single mapping from `disabledReason` to a display status. */
// Exhaustive by design: one branch per terminal reason.
// fallow-ignore-next-line complexity
export function getScheduledPromptStatus(p: {
  disabledReason?: ScheduledPromptDisabledReason;
}): ScheduledPromptStatus {
  switch (p.disabledReason) {
    case undefined:
      return 'active';
    case 'user':
      return 'disabled';
    case 'archive':
      return 'archived';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
  }
}

/** Display label for a derived status. */
// Exhaustive by design: one branch per status.
// fallow-ignore-next-line complexity
export function formatScheduledPromptStatus(s: ScheduledPromptStatus): string {
  switch (s) {
    case 'active':
      return 'Active';
    case 'disabled':
      return 'Disabled';
    case 'archived':
      return 'Disabled by archive';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
  }
}

export function isFinishedScheduledPromptStatus(s: ScheduledPromptStatus): boolean {
  return s === 'completed' || s === 'failed';
}
