/** Workflow definitions, UI section mappings, and action guards for task origins (backlog, chat). */

import type { TaskStatus } from './taskStateMachine';

/**
 * Task origins - where the task was created
 */
export type TaskOrigin = 'backlog' | 'chat';

/**
 * UI sections where tasks can appear
 */
export type TaskSection =
  | 'backlog' // Backlog tab
  | 'current' // Current/active task section
  | 'pending_review' // Pending user review section
  | 'archived'; // Archived/completed section

/** Allowed status transitions per origin and terminal states for each workflow. */
export const TASK_WORKFLOWS = {
  backlog: {
    initial: 'backlog' as const, // Starts in backlog tab
    transitions: {
      backlog: ['pending'], // User moves backlog item to chat
      pending: ['in_progress'], // Automatic: agent task-started
      in_progress: ['pending_user_review'], // Agent completes
      pending_user_review: ['completed', 'closed', 'pending'], // User decides or sends back for re-work
    },
    terminal: ['completed', 'closed'] as const,
  },
  chat: {
    initial: 'pending' as const, // Starts as pending (task created at promotion time)
    transitions: {
      pending: ['in_progress'], // Automatic: agent task-started
      in_progress: ['completed'], // Agent finishes
    },
    terminal: ['completed'] as const,
  },
} as const;

/** Returns the UI section for a task based on its status. */
export function getTaskSection(_origin: TaskOrigin | undefined, status: TaskStatus): TaskSection {
  // Backlog status - shows in backlog section
  // This is the initial state for backlog-origin tasks (before moved to chat)
  if (status === 'backlog') {
    return 'backlog';
  }

  // Terminal states
  if (status === 'completed' || status === 'closed') {
    return 'archived';
  }

  // Pending user review (backlog only) - shows in pending review section
  if (status === 'pending_user_review') {
    return 'pending_review';
  }

  // Active work - shows in current section
  // Includes acknowledged states (agent has claimed but not started)
  if (
    status === 'in_progress' ||
    status === 'pending' ||
    status === 'acknowledged'
  ) {
    return 'current';
  }

  // Fallback
  return 'archived';
}

/**
 * Get allowed next statuses for a task
 */
export function getNextStatuses(origin: TaskOrigin | undefined, status: TaskStatus): TaskStatus[] {
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
  if (!origin) {
    // Legacy tasks - completed and closed are terminal
    return status === 'completed' || status === 'closed';
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
  // Only backlog-origin tasks can be added to chat
  if (origin !== 'backlog') {
    return false;
  }

  // Allow adding from:
  // - 'backlog' state (task is in backlog tab, not yet moved to chat)
  // - 'pending_user_review' state (for re-review after agent completion)
  return status === 'backlog' || status === 'pending_user_review';
}

/** Returns the completion status a task should transition to when the agent finishes work. */
export function getCompletionStatus(
  origin: TaskOrigin | undefined,
  currentStatus: TaskStatus
): TaskStatus {
  // Only handle in_progress → completion transitions
  if (currentStatus !== 'in_progress') {
    // For other statuses, return completed as fallback
    return 'completed';
  }

  // Get next valid statuses from workflow
  const nextStatuses = getNextStatuses(origin, currentStatus);

  // Return the first valid transition (should be the completion status)
  // For backlog: pending_user_review
  // For chat: completed
  if (nextStatuses.length > 0) {
    return nextStatuses[0]!;
  }

  // Fallback for legacy tasks without origin
  return 'completed';
}
