/**
 * Presentation helpers for the event stream feature.
 * Used by ChatroomTimelineFeed, EventStreamModal, and event type renderers.
 *
 * Core types live in `src/domain/entities/event-type.ts` and
 * `src/domain/entities/event-stream-event.ts`.
 */

import { DateTime } from 'luxon';

import type { EventBadgeVariant } from '@/domain/entities/event-type';
import { isSupportedEventType, SUPPORTED_EVENT_TYPES } from '@/domain/entities/event-type';

export type {
  EventBadgeVariant,
  EventTypeName,
  SupportedEventTypeMeta,
} from '@/domain/entities/event-type';
export {
  isSupportedEventType,
  SUPPORTED_EVENT_TYPES,
  SUPPORTED_EVENT_TYPE_NAMES,
} from '@/domain/entities/event-type';

export type {
  AgentCircuitOpenEvent,
  AgentExitedEvent,
  AgentRegisteredEvent,
  AgentRequestStartEvent,
  AgentRequestStopEvent,
  AgentRestartLimitReachedEvent,
  AgentSessionResumedEvent,
  AgentSessionResumeFailedEvent,
  AgentStartFailedEvent,
  AgentStartedEvent,
  AgentWaitingEvent,
  CommandRunEvent,
  CommandStopEvent,
  ConfigRequestRemovalEvent,
  DaemonGitRefreshEvent,
  DaemonLocalActionEvent,
  DaemonPingEvent,
  DaemonPongEvent,
  DaemonRefreshCapabilitiesEvent,
  EventStreamEvent,
  EventStreamEventBase,
  MachineSwitchedEvent,
  SkillActivatedEvent,
  TaskActivatedEvent,
  TaskAcknowledgedEvent,
  TaskCompletedEvent,
  TaskInProgressEvent,
  WorkflowCompletedEvent,
  WorkflowCreatedEvent,
  WorkflowSpecifiedEvent,
  WorkflowStartedEvent,
  WorkflowStepCancelledEvent,
  WorkflowStepCompletedEvent,
  WorkflowStepStartedEvent,
} from '@/domain/entities/event-stream-event';

const EVENT_BADGE_TEXT_COLORS: Record<EventBadgeVariant, string> = {
  info: 'text-chatroom-status-info',
  success: 'text-chatroom-status-success',
  warning: 'text-chatroom-status-warning',
  error: 'text-chatroom-status-error',
  muted: 'text-chatroom-text-muted',
  purple: 'text-chatroom-status-purple',
};

/** Human-readable label for a supported event type. Falls back to the raw type string. */
export function formatEventType(type: string): string {
  if (isSupportedEventType(type)) {
    return SUPPORTED_EVENT_TYPES[type].label;
  }
  return type;
}

/** Tailwind text color class for timeline badges. */
export function getEventBadgeTextColor(type: string): string {
  if (isSupportedEventType(type)) {
    return EVENT_BADGE_TEXT_COLORS[SUPPORTED_EVENT_TYPES[type].badge];
  }
  return EVENT_BADGE_TEXT_COLORS.info;
}

/** e.g. 12 → "12th" */
function ordinalDay(day: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = day % 100;
  return `${day}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`;
}

/** e.g. "12th June, 10:00pm" */
function formatChatroomTimestamp(ms: number, includeYear: boolean): string {
  const dt = DateTime.fromMillis(ms);
  const datePart = includeYear
    ? `${ordinalDay(dt.day)} ${dt.toFormat('MMMM yyyy')}`
    : `${ordinalDay(dt.day)} ${dt.toFormat('MMMM')}`;
  const timePart = dt.toFormat('h:mma').toLowerCase();
  return `${datePart}, ${timePart}`;
}

/** Format a Unix millisecond timestamp for timeline rows (ordinal day, full month, 12-hour time). */
export function formatTimestamp(ms: number): string {
  const dt = DateTime.fromMillis(ms);
  const includeYear = dt.year !== DateTime.now().year;
  return formatChatroomTimestamp(ms, includeYear);
}

/** Format a Unix millisecond timestamp with year (detail panels). */
export function formatTimestampFull(ms: number): string {
  return formatChatroomTimestamp(ms, true);
}
