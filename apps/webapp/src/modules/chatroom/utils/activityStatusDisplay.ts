import type { ChatroomActivityStatus } from '@workspace/shared/domain/chatroom-activity-status';

/**
 * Shared chatroom-level status display utilities.
 * Single source of truth for listing page, Cmd+K switcher, and sidebar indicators.
 */

const CHATROOM_ACTIVITY_DISPLAY: Record<
  ChatroomActivityStatus,
  { indicatorClass: string; description: string }
> = {
  working: {
    indicatorClass: 'bg-chatroom-status-info',
    description: 'Agents are working on tasks',
  },
  active: {
    indicatorClass: 'bg-chatroom-status-success',
    description: 'Agents are waiting for tasks',
  },
  transitioning: {
    indicatorClass: 'bg-chatroom-status-warning',
    description: 'Agents are online but not yet waiting for tasks',
  },
  idle: {
    indicatorClass: 'bg-chatroom-text-muted opacity-40',
    description: 'No agents online',
  },
  completed: {
    indicatorClass: 'bg-chatroom-text-muted opacity-40',
    description: 'Archived',
  },
};

const INDICATOR_BASE = 'w-1.5 h-1.5 flex-shrink-0';

/** Tailwind classes for the status square indicator (theme: square dots). */
export function getChatroomActivityIndicatorClasses(
  activityStatus: ChatroomActivityStatus
): string {
  return `${INDICATOR_BASE} ${CHATROOM_ACTIVITY_DISPLAY[activityStatus].indicatorClass}`;
}

export function getChatroomActivityIndicatorLoadingClasses(): string {
  return `${INDICATOR_BASE} bg-chatroom-text-muted opacity-40`;
}

/** Short label for compact UI (listing cards, table rows). */
/** Accessible description of what the status means for the user. */
export function getChatroomActivityDescription(activityStatus: ChatroomActivityStatus): string {
  return CHATROOM_ACTIVITY_DISPLAY[activityStatus].description;
}
