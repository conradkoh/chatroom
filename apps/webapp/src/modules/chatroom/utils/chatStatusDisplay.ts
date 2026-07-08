import type { ChatStatus } from './deriveChatStatus';

/**
 * Shared chatroom-level status display utilities.
 * Single source of truth for listing page, Cmd+K switcher, and sidebar indicators.
 */

const CHAT_STATUS_DISPLAY: Record<
  ChatStatus,
  { indicatorClass: string; label: string; description: string }
> = {
  working: {
    indicatorClass: 'bg-chatroom-status-info',
    label: 'Working',
    description: 'Agents are working on tasks',
  },
  active: {
    indicatorClass: 'bg-chatroom-status-success',
    label: 'Active',
    description: 'Agents are online and waiting for tasks',
  },
  idle: {
    indicatorClass: 'bg-chatroom-text-muted opacity-40',
    label: 'Idle',
    description: 'No agents online',
  },
  completed: {
    indicatorClass: 'bg-chatroom-text-muted opacity-40',
    label: 'Completed',
    description: 'Archived',
  },
};

const INDICATOR_BASE = 'w-1.5 h-1.5 flex-shrink-0';

/** Tailwind classes for the status square indicator (theme: square dots). */
export function getChatStatusIndicatorClasses(chatStatus: ChatStatus): string {
  return `${INDICATOR_BASE} ${CHAT_STATUS_DISPLAY[chatStatus].indicatorClass}`;
}

/** Short label for compact UI (listing cards, table rows). */
export function getChatStatusLabel(chatStatus: ChatStatus): string {
  return CHAT_STATUS_DISPLAY[chatStatus].label;
}

/** Accessible description of what the status means for the user. */
export function getChatStatusDescription(chatStatus: ChatStatus): string {
  return CHAT_STATUS_DISPLAY[chatStatus].description;
}
