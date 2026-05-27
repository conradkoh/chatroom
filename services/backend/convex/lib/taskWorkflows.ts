/**
 * Workflow definitions and action guards for tasks.
 * Backlog items are now managed separately in chatroom_backlog table.
 */

import type { TaskStatus } from './taskStateMachine';

/**
 * UI sections where tasks can appear
 */
export type TaskSection =
  | 'current' // Current/active task section
  | 'archived'; // Archived/completed section

/** Returns the UI section for a task based on its status. */
export function getTaskSection(status: TaskStatus): TaskSection {
  // Terminal state
  if (status === 'completed') {
    return 'archived';
  }

  // Active work - shows in current section
  // Includes acknowledged state (agent has claimed but not started)
  if (status === 'in_progress' || status === 'pending' || status === 'acknowledged') {
    return 'current';
  }

  // Fallback
  return 'archived';
}

/**
 * Check if a status transition is valid
 */
export function isValidTransition(fromStatus: TaskStatus, toStatus: TaskStatus): boolean {
  // Chat-origin workflow transitions:
  // pending → acknowledged (claimTask)
  // acknowledged → in_progress (startTask)
  // in_progress → completed (completeTask)
  // pending → completed (completeTaskById - force)
  // acknowledged → completed (completeTaskById - force)

  const validTransitions: Record<string, TaskStatus[]> = {
    pending: ['acknowledged', 'completed'],
    acknowledged: ['in_progress', 'completed'],
    in_progress: ['completed'],
  };

  const allowed = validTransitions[fromStatus] ?? [];
  return allowed.includes(toStatus);
}

/**
 * Check if a task is in a terminal state
 */
export function isTerminalStatus(status: TaskStatus): boolean {
  return status === 'completed';
}

/**
 * Get allowed next statuses for a task
 */
export function getNextStatuses(status: TaskStatus): TaskStatus[] {
  const transitions: Record<string, TaskStatus[]> = {
    pending: ['acknowledged', 'completed'],
    acknowledged: ['in_progress', 'completed'],
    in_progress: ['completed'],
    completed: [],
  };

  return transitions[status] ?? [];
}

/** Returns the completion status a task should transition to when the agent finishes work. */
export function getCompletionStatus(currentStatus: TaskStatus): TaskStatus {
  // All tasks transition to 'completed' when work is done
  if (currentStatus === 'in_progress' || currentStatus === 'acknowledged') {
    return 'completed';
  }

  // Fallback
  return 'completed';
}
