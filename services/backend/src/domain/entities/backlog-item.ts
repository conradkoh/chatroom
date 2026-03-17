/**
 * Domain Model: BacklogItem
 *
 * Shared backlog item-related constants and helpers. The canonical BacklogItemStatus
 * type lives in convex/lib/backlogStateMachine.ts — this module provides derived
 * constants that multiple consumers need.
 */

import type { BacklogItemStatus } from '../../../convex/lib/backlogStateMachine';
import { canTransition as fsmCanTransition } from '../../../convex/lib/backlogStateMachine';

/**
 * Backlog item statuses that indicate active work (not closed).
 * Used for filtering active items in queries and guards.
 */
export const ACTIVE_BACKLOG_STATUSES: ReadonlySet<BacklogItemStatus> = new Set([
  'backlog',
  'pending_user_review',
]);

/**
 * The terminal status for backlog items.
 */
export const TERMINAL_BACKLOG_STATUS: BacklogItemStatus = 'closed';

/**
 * Returns true if the backlog item is in an active status (not closed).
 */
export function isActiveBacklogItem(status: string): boolean {
  return ACTIVE_BACKLOG_STATUSES.has(status as BacklogItemStatus);
}

/**
 * Returns true if the backlog item content can be edited.
 * Only items in 'backlog' status can have their content modified.
 */
export function canEditBacklogContent(status: string): boolean {
  return status === 'backlog';
}

/**
 * Checks if a transition from `current` to `target` is valid according to the FSM.
 */
export function canTransitionTo(
  current: BacklogItemStatus,
  target: BacklogItemStatus
): boolean {
  // The FSM's canTransition requires a full BacklogItem Doc, but only uses .status for the check
  return fsmCanTransition({ status: current } as any, target);
}
