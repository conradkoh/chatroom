import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/**
 * Shared helper to recover orphaned in_progress tasks for a given role.
 * Used by both:
 * - participants.join (agent rejoin recovery)
 * - cleanupStaleAgents (cron-based cleanup)
 *
 * Returns array of recovered task IDs for logging.
 */
export async function recoverOrphanedTasks(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<string[]> {
  const orphanedTasks = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom_status', (q) =>
      q.eq('chatroomId', chatroomId).eq('status', 'in_progress')
    )
    .filter((q) => q.eq(q.field('assignedTo'), role))
    .collect();

  const recoveredIds: string[] = [];
  const now = Date.now();

  for (const task of orphanedTasks) {
    await ctx.db.patch('chatroom_tasks', task._id, {
      status: 'pending',
      assignedTo: undefined,
      startedAt: undefined,
      updatedAt: now,
    });
    recoveredIds.push(task._id);
  }

  return recoveredIds;
}
