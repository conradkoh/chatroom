/**
 * promote-next-task usecase
 *
 * Promotes the oldest queued task to pending when all agents in the chatroom
 * are idle (waiting for a task).
 *
 * This usecase is the single source of truth for queue promotion logic.
 * All callers — task completion, cancellation, force-completion, handoff,
 * and agent join — must delegate to this function instead of duplicating
 * the promotion logic inline.
 *
 * ## Design
 *
 * The function accepts explicit dependency interfaces rather than a Convex
 * context directly, making it pure and trivially unit-testable.
 *
 * The caller is responsible for wiring real implementations from `ctx`.
 *
 * ## Trigger Flow
 *
 * 1. Check if all agents in the chatroom are idle via `deps.areAllAgentsIdle`
 * 2. If not idle → return `{ promoted: null, reason: 'agents_not_idle' }`
 * 3. Query the oldest queued task by `queuePosition` via `deps.getOldestQueuedTask`
 * 4. If no queued task → return `{ promoted: null, reason: 'no_queued_tasks' }`
 * 5. Transition it to `pending` via `deps.transitionTask`
 * 6. Return `{ promoted: taskId, reason: 'success' }`
 */

import type { Id } from '../../../../convex/_generated/dataModel';

// ============================================================================
// DEPENDENCY INTERFACES
// ============================================================================

/**
 * Task shape required by promote-next-task.
 * Only the fields the usecase needs — no full Doc dependency.
 */
export interface QueuedTask {
  _id: Id<'chatroom_tasks'>;
  queuePosition: number;
}

/**
 * Explicit dependencies for promoteNextTask.
 * Inject real implementations from ctx in mutations.
 * Inject mocks in tests.
 */
export interface PromoteNextTaskDeps {
  /**
   * Returns true if every participant in the chatroom has
   * `lastSeenAction === 'get-next-task:started'`.
   */
  areAllAgentsIdle: (chatroomId: Id<'chatroom_rooms'>) => Promise<boolean>;

  /**
   * Returns all tasks in the chatroom with status 'queued',
   * sorted by queuePosition ascending (oldest first).
   * Returns an empty array if none exist.
   */
  getOldestQueuedTask: (chatroomId: Id<'chatroom_rooms'>) => Promise<QueuedTask | null>;

  /**
   * Transitions a task to pending using the 'promoteNextTask' trigger.
   * Must throw if the transition is invalid.
   */
  transitionTaskToPending: (taskId: Id<'chatroom_tasks'>) => Promise<void>;
}

// ============================================================================
// RESULT TYPE
// ============================================================================

export type PromoteNextTaskResult =
  | { promoted: Id<'chatroom_tasks'>; reason: 'success' }
  | { promoted: null; reason: 'agents_not_idle' | 'no_queued_tasks' };

// ============================================================================
// USECASE
// ============================================================================

/**
 * Promotes the next queued task to pending if all agents are idle.
 *
 * Pure function — all side effects are injected via `deps`.
 *
 * @param chatroomId - The chatroom to check and promote within.
 * @param deps - Injected dependencies.
 * @returns The result of the promotion attempt.
 */
export async function promoteNextTask(
  chatroomId: Id<'chatroom_rooms'>,
  deps: PromoteNextTaskDeps
): Promise<PromoteNextTaskResult> {
  // 1. Guard: all agents must be idle before we promote
  const allIdle = await deps.areAllAgentsIdle(chatroomId);
  if (!allIdle) {
    return { promoted: null, reason: 'agents_not_idle' };
  }

  // 2. Find the oldest queued task
  const nextTask = await deps.getOldestQueuedTask(chatroomId);
  if (!nextTask) {
    return { promoted: null, reason: 'no_queued_tasks' };
  }

  // 3. Promote: queued → pending
  await deps.transitionTaskToPending(nextTask._id);

  return { promoted: nextTask._id, reason: 'success' };
}
