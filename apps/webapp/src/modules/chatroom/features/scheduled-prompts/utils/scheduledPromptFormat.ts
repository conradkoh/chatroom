import type { Doc } from '@workspace/backend/convex/_generated/dataModel';

import { formatDailyScheduleLocal, formatTimestampLocal } from './scheduledPromptTimezone';
import { formatTimestampFull } from '../../../utils/chatroomTimestamp';

export type ScheduledPromptScheduleKind = Doc<'chatroom_scheduledPrompts'>['scheduleKind'];
type ScheduledPromptDisabledReason = NonNullable<
  Doc<'chatroom_scheduledPrompts'>['disabledReason']
>;

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

/** Local calendar-day number (UTC-normalised) so DST and time never shift the day. */
function localDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Next-run label in local time: "Today 14:30", "Tomorrow 09:00", or
 * "Nov 5 17:00". Days are compared on the local calendar, not by elapsed hours.
 */
export function formatUpcomingRun(ts: number, now: number = Date.now()): string {
  const target = new Date(ts);
  const dayDiff = Math.round(
    (localDayNumber(target) - localDayNumber(new Date(now))) / (24 * 60 * 60 * 1000)
  );
  const time = formatTime(ts);
  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return `Tomorrow ${time}`;
  const date = target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${date} ${time}`;
}

/** Reads the `code` a ConvexError carries under `data`. */
function backendErrorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  const data = (error as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return undefined;
  return (data as { code?: unknown }).code;
}

const ACTION_ERROR_MESSAGE: Record<string, string> = {
  SCHEDULE_FINISHED: 'This prompt has already run.',
  LIFECYCLE_DISABLED: "This prompt is archived and can't be changed.",
  NOT_FOUND: 'This prompt was deleted.',
};

/** User-facing text for a failed sidebar action; unknown failures use `fallback`. */
export function scheduledPromptActionErrorMessage(error: unknown, fallback: string): string {
  const code = backendErrorCode(error);
  return typeof code === 'string' ? (ACTION_ERROR_MESSAGE[code] ?? fallback) : fallback;
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
