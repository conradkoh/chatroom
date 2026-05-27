/**
 * promote-next-task usecase
 *
 * Promotes the oldest queued message (from chatroom_messageQueue) to an active task
 * when no active tasks (pending, acknowledged, or in_progress) exist in the chatroom.
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
 * Use `makePromoteNextTaskDeps(ctx)` from `convex/lib/promoteNextTaskDeps.ts`
 * to create the standard wiring.
 *
 * ## Trigger Flow
 *
 * 1. Check if promotion is allowed via `deps.canPromote` (no active tasks)
 * 2. If not allowed → return `{ promoted: null, reason: 'active_task_exists' }`
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
  queuePosition: number;
}

/**
 * Explicit dependencies for promoteNextTask.
 * Inject real implementations from ctx in mutations.
 * Inject mocks in tests.
 *
 * Use `makePromoteNextTaskDeps(ctx)` for the standard wiring.
 */
export interface PromoteNextTaskDeps {
  /**
   * Returns true if promotion is allowed — i.e. no tasks with active status
   * (pending, acknowledged, or in_progress) exist in the chatroom.
   *
   * This is the authoritative promotion guard. Task state is the source of
   * truth — unlike participant `lastSeenAction`, it is always up-to-date.
   */
  canPromote: (chatroomId: Id<'chatroom_rooms'>) => Promise<boolean>;

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
  | { promoted: null; reason: 'active_task_exists' | 'no_queued_tasks' };

// ============================================================================
// USECASE
// ============================================================================

/**
 * Promotes the next queued message to a pending task if no active tasks exist.
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
  // 1. Guard: no active tasks must exist before we promote.
  //    Task state is the source of truth — always up-to-date.
  const allowed = await deps.canPromote(chatroomId);
  if (!allowed) {
    return { promoted: null, reason: 'active_task_exists' };
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
