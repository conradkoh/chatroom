import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

/** Resolves the acknowledged task for a role, optionally by explicit task id. */
export async function findAcknowledgedTaskForRole(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    taskId?: Id<'chatroom_tasks'>;
  }
) {
  if (args.taskId) {
    return ctx.db.get('chatroom_tasks', args.taskId);
  }
  return ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom_status_assignedTo', (q) =>
      q.eq('chatroomId', args.chatroomId).eq('status', 'acknowledged').eq('assignedTo', args.role)
    )
    .first();
}
