/**
 * Task Workflow Definitions
 *
 * Defines the state machines for different task origins.
 * Each origin (backlog, chat) has its own workflow with allowed transitions.
 */

/**
 * Task origins - where the task was created
 */
export type TaskOrigin = 'backlog' | 'chat';

/**
 * Task statuses - lifecycle stages
 */
export type TaskStatus =
  | 'pending' // Backlog: in backlog tab / Chat: ready for agent
  | 'queued' // Waiting in line
  | 'in_progress' // Agent working
  | 'pending_user_review' // Backlog only: agent done, user confirms
  | 'completed' // Finished
  | 'closed' // Backlog only: user closed without completing
  // Deprecated statuses (for migration compatibility)
  | 'backlog' // DEPRECATED: Use origin='backlog' + status='pending'
  | 'cancelled'; // DEPRECATED: Use 'closed'

/**
 * UI sections where tasks can appear
 */
export type TaskSection =
  | 'backlog' // Backlog tab
  | 'queued' // Queue section
  | 'current' // Current/active task section
  | 'pending_review' // Pending user review section
  | 'archived'; // Archived/completed section

/**
 * Workflow definitions for each origin
 */
export const TASK_WORKFLOWS = {
  backlog: {
    initial: 'pending' as const,
    transitions: {
      pending: ['queued'], // User moves to chat
      queued: ['pending'], // Becomes next in line
      // Note: pending→in_progress happens when there's no queue
      in_progress: ['pending_user_review'], // Agent completes
      pending_user_review: ['completed', 'closed', 'queued'], // User decides or sends back
    },
    terminal: ['completed', 'closed'] as const,
  },
  chat: {
    initial: 'queued' as const,
    transitions: {
      queued: ['pending'], // Becomes next in line
      pending: ['in_progress'], // Agent starts
      in_progress: ['completed'], // Agent finishes
    },
    terminal: ['completed'] as const,
  },
} as const;

/**
 * Get the UI section for a task based on its origin and status
 */
export function getTaskSection(origin: TaskOrigin | undefined, status: TaskStatus): TaskSection {
  // Handle deprecated statuses
  if (status === 'backlog') {
    return 'backlog';
  }
  if (status === 'cancelled') {
    return 'archived';
  }

  // Terminal states
  if (status === 'completed' || status === 'closed') {
    return 'archived';
  }

  // Pending user review (backlog only)
  if (status === 'pending_user_review') {
    return 'pending_review';
  }

  // Active work
  if (status === 'in_progress') {
    return 'current';
  }

  // Queued
  if (status === 'queued') {
    return 'queued';
  }

  // Pending - depends on origin
  if (status === 'pending') {
    if (origin === 'backlog') {
      return 'backlog';
    }
    return 'current'; // Chat tasks in pending are ready for agent
  }

  // Fallback
  return 'archived';
}

/**
 * Get allowed next statuses for a task
 */
export function getNextStatuses(origin: TaskOrigin | undefined, status: TaskStatus): TaskStatus[] {
  // Handle deprecated statuses
  if (status === 'backlog') {
    // Old backlog items can be moved to queue
    return ['queued'];
  }
  if (status === 'cancelled') {
    // Terminal state
    return [];
  }

  if (!origin) {
    // Legacy task without origin - limited transitions
    return [];
  }

  const workflow = TASK_WORKFLOWS[origin];
  const transitions = workflow.transitions as Record<string, readonly string[]>;

  return (transitions[status] ?? []) as TaskStatus[];
}

/**
 * Check if a status transition is valid
 */
export function isValidTransition(
  origin: TaskOrigin | undefined,
  fromStatus: TaskStatus,
  toStatus: TaskStatus
): boolean {
  const allowed = getNextStatuses(origin, fromStatus);
  return allowed.includes(toStatus);
}

/**
 * Check if a task is in a terminal state
 */
export function isTerminalStatus(origin: TaskOrigin | undefined, status: TaskStatus): boolean {
  // Deprecated terminal states
  if (status === 'cancelled') {
    return true;
  }

  if (!origin) {
    // Legacy tasks - completed is terminal
    return status === 'completed';
  }

  const workflow = TASK_WORKFLOWS[origin];
  return (workflow.terminal as readonly string[]).includes(status);
}

/**
 * Check if "Mark Complete" action is available for a task
 */
export function canMarkComplete(origin: TaskOrigin | undefined, status: TaskStatus): boolean {
  // Only backlog-origin tasks can be marked complete by user
  if (origin !== 'backlog') {
    return false;
  }

  // Must be in pending_user_review state
  return status === 'pending_user_review';
}

/**
 * Check if "Close" action is available for a task
 */
export function canClose(origin: TaskOrigin | undefined, status: TaskStatus): boolean {
  // Only backlog-origin tasks can be closed
  if (origin !== 'backlog') {
    return false;
  }

  // Can close from pending_user_review
  return status === 'pending_user_review';
}

/**
 * Check if "Send Back for Re-work" action is available
 */
export function canSendBackForRework(origin: TaskOrigin | undefined, status: TaskStatus): boolean {
  // Only backlog-origin tasks in pending_user_review can be sent back
  if (origin !== 'backlog') {
    return false;
  }

  return status === 'pending_user_review';
}

/**
 * Check if task can be added to chat (attached to a message)
 */
export function canAddToChat(origin: TaskOrigin | undefined, status: TaskStatus): boolean {
  // Only backlog-origin tasks in pending state can be added to chat
  if (origin !== 'backlog') {
    return false;
  }

  // Allow adding from pending (backlog tab) or pending_user_review (for re-review)
  return status === 'pending' || status === 'pending_user_review';
}
