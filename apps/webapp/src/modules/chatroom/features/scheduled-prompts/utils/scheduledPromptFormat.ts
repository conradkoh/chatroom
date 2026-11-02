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

// Three schedule kinds, exhaustive switch with a never default.
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
    default: {
      const never: never = prompt.scheduleKind;
      throw new Error(`Unknown scheduleKind ${String(never)}`);
    }
  }
}

export function formatTime(ts: number): string {
  return formatTimestampLocal(ts);
}

/** The single mapping from `disabledReason` to a display status. */
const STATUS_BY_DISABLED_REASON: Record<
  ScheduledPromptDisabledReason | 'none',
  ScheduledPromptStatus
> = {
  none: 'active',
  user: 'disabled',
  archive: 'archived',
  completed: 'completed',
  failed: 'failed',
};

export function getScheduledPromptStatus(p: {
  disabledReason?: ScheduledPromptDisabledReason;
}): ScheduledPromptStatus {
  return STATUS_BY_DISABLED_REASON[p.disabledReason ?? 'none'];
}

/** Display label for a derived status. */
const STATUS_LABEL: Record<ScheduledPromptStatus, string> = {
  active: 'Active',
  disabled: 'Disabled',
  archived: 'Disabled by archive',
  completed: 'Completed',
  failed: 'Failed',
};

export function formatScheduledPromptStatus(s: ScheduledPromptStatus): string {
  return STATUS_LABEL[s];
}

export function isFinishedScheduledPromptStatus(s: ScheduledPromptStatus): boolean {
  return s === 'completed' || s === 'failed';
}
