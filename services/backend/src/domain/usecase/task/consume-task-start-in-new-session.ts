import { normalizeTaskEnvelope } from '@workspace/shared/domain/task-envelope';

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { projectAssignedTaskSnapshotsForChatroom } from '../machine/machine-assigned-task-snapshot-sync';

/**
 * Consumes a one-shot "start in a new session" request exactly once.
 *
 * The canonical request intent lives in the immutable `taskEnvelope` snapshot;
 * `sessionPolicyConsumedAt` is execution state tracking whether that request was
 * actually honored, and is deliberately kept outside the envelope. A successful
 * consumption records the receipt and clears only the legacy `startInNewSession`
 * scalar for reader compatibility — the envelope is never mutated or rewritten.
 */
export async function consumeTaskStartInNewSession(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>
): Promise<boolean> {
  const task = await ctx.db.get('chatroom_tasks', taskId);
  if (!task) return false;

  // An explicit envelope wins over stale legacy scalars. A missing envelope is
  // normalized from the legacy `startInNewSession` scalar (default: continue).
  const envelope = normalizeTaskEnvelope(task);
  if (envelope.sessionPolicy !== 'new' || task.sessionPolicyConsumedAt !== undefined) {
    return false;
  }

  const consumedAt = Date.now();
  await ctx.db.patch('chatroom_tasks', taskId, {
    startInNewSession: undefined,
    sessionPolicyConsumedAt: consumedAt,
    updatedAt: consumedAt,
  });
  await projectAssignedTaskSnapshotsForChatroom(ctx, task.chatroomId);
  return true;
}
