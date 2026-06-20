/**
 * Presentation helpers for the event stream feature.
 * Used by ChatroomTimelineFeed, EventStreamModal, and event type renderers.
 *
 * Core types live in `src/domain/entities/event-type.ts` and
 * `src/domain/entities/event-stream-event.ts`.
 */

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

/** Format a Unix millisecond timestamp as MM/DD HH:MM:SS (24-hour). */
export function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const dateStr = date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${dateStr} ${timeStr}`;
}

/** Format a Unix millisecond timestamp with full date and time. */
export function formatTimestampFull(ms: number): string {
  const date = new Date(ms);
  const dateStr = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${dateStr} ${timeStr}`;
}
