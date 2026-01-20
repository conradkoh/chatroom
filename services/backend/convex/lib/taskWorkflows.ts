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
  | 'backlog' // Backlog only: initial state in backlog tab (before moved to chat)
  | 'queued' // Waiting in line
  | 'pending' // Ready for agent
  | 'in_progress' // Agent working
  | 'pending_user_review' // Backlog only: agent done, user confirms
  | 'completed' // Finished
  | 'closed' // Backlog only: user closed without completing
  | 'cancelled'; // DEPRECATED: kept for backward compat with existing data

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
 *
 * Backlog workflow:
 *   backlog → (user moves to chat) → queued → pending → in_progress →
 *   pending_user_review → completed/closed OR back to queued
 *
 * Chat workflow:
 *   queued → pending → in_progress → completed
 *
 * Note: queued→pending and pending→in_progress transitions happen automatically
 * when the agent acknowledges tasks (task-started event).
 */
export const TASK_WORKFLOWS = {
  backlog: {
    initial: 'backlog' as const, // Starts in backlog tab
    transitions: {
      backlog: ['queued'], // User moves backlog item to chat
      queued: ['pending'], // Automatic: becomes next in line
      pending: ['in_progress'], // Automatic: agent task-started
      in_progress: ['pending_user_review'], // Agent completes
      pending_user_review: ['completed', 'closed', 'queued'], // User decides or sends back for re-work
    },
    terminal: ['completed', 'closed'] as const,
  },
  chat: {
    initial: 'queued' as const, // Starts in queue
    transitions: {
      queued: ['pending'], // Automatic: becomes next in line
      pending: ['in_progress'], // Automatic: agent task-started
      in_progress: ['completed'], // Agent finishes
    },
    terminal: ['completed'] as const,
  },
} as const;

/**
 * Get the UI section for a task based on its origin and status
 * Note: origin is kept for future use but currently section is determined purely by status
 */
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
  if (status === 'in_progress' || status === 'pending') {
    return 'current';
  }

  // Queued - shows in queued section
  if (status === 'queued') {
    return 'queued';
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
    // Backlog items without origin can still be moved to queue
    if (status === 'backlog') {
      return ['queued'];
    }
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

/**
 * Get the completion status for a task when agent finishes work
 *
 * Uses the workflow transitions to determine the correct next status.
 * For backlog-origin tasks: in_progress → pending_user_review
 * For chat-origin tasks: in_progress → completed
 *
 * @param origin - Task origin (backlog or chat)
 * @param currentStatus - Current task status (should be in_progress)
 * @returns The status the task should transition to
 */
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
