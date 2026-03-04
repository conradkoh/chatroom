/**
 * promote-next-task usecase
 *
 * Promotes the oldest queued message (from chatroom_messageQueue) to an active task
 * when all agents in the chatroom are waiting (in the get-next-task loop).
 *
 * This usecase is the single source of truth for automatic queue promotion logic.
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
 * 1. Check if all agents in the chatroom are waiting via `deps.areAllAgentsWaiting`
 * 2. If not waiting → return `{ promoted: null, reason: 'agents_busy' }`
 * 3. Query the oldest queued message via `deps.getOldestQueuedMessage`
 * 4. If no queued message → return `{ promoted: null, reason: 'no_queued_tasks' }`
 * 5. Promote via `deps.promoteQueuedMessage`
 * 6. Return `{ promoted: taskId, reason: 'success' }`
 */

import type { Id } from '../../../../convex/_generated/dataModel';

// ============================================================================
// DEPENDENCY INTERFACES
// ============================================================================

/**
 * Queue record shape required by promote-next-task.
 */
export interface QueuedMessage {
  _id: Id<'chatroom_messageQueue'>;
  queuePosition?: number;
}

/**
 * Explicit dependencies for promoteNextTask.
 * Inject real implementations from ctx in mutations.
 * Inject mocks in tests.
 */
export interface PromoteNextTaskDeps {
  /**
   * Returns true if every participant in the chatroom has
   * `lastSeenAction === 'get-next-task:started'` (i.e. is in the wait loop).
   */
  areAllAgentsWaiting: (chatroomId: Id<'chatroom_rooms'>) => Promise<boolean>;

  /**
   * Returns the oldest queued message record for a chatroom.
   * Returns null if none exist.
   */
  getOldestQueuedMessage: (chatroomId: Id<'chatroom_rooms'>) => Promise<QueuedMessage | null>;

  /**
   * Promotes a queue record: creates message + task, deletes queue record.
   * Returns { taskId } on success.
   */
  promoteQueuedMessage: (
    queuedMessageId: Id<'chatroom_messageQueue'>
  ) => Promise<{ taskId: Id<'chatroom_tasks'> } | null>;
}

// ============================================================================
// RESULT TYPE
// ============================================================================

export type PromoteNextTaskResult =
  | { promoted: Id<'chatroom_tasks'>; reason: 'success' }
  | { promoted: null; reason: 'agents_busy' | 'no_queued_tasks' };

// ============================================================================
// USECASE
// ============================================================================

/**
 * Promotes the next queued message to a pending task if all agents are waiting.
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
  // 1. Guard: all agents must be waiting (in the get-next-task loop) before we promote
  const allWaiting = await deps.areAllAgentsWaiting(chatroomId);
  if (!allWaiting) {
    return { promoted: null, reason: 'agents_busy' };
  }

  // 2. Find the oldest queued message
  const nextMessage = await deps.getOldestQueuedMessage(chatroomId);
  if (!nextMessage) {
    return { promoted: null, reason: 'no_queued_tasks' };
  }

  // 3. Promote: queue record → message + task
  const result = await deps.promoteQueuedMessage(nextMessage._id);
  if (!result) {
    return { promoted: null, reason: 'no_queued_tasks' };
  }

  return { promoted: result.taskId, reason: 'success' };
}
