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
  const normalizedRole = args.role.toLowerCase();
  const tasks = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom_status', (q) =>
      q.eq('chatroomId', args.chatroomId).eq('status', 'acknowledged')
    )
    .collect();
  return tasks.find((task) => task.assignedTo?.toLowerCase() === normalizedRole) ?? null;
}

/** Active assigned task for a role: acknowledged (awaiting tokens) or in_progress (working). */
export async function findActiveAssignedTaskForRole(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
  }
) {
  const normalizedRole = args.role.toLowerCase();
  for (const status of ['in_progress', 'acknowledged'] as const) {
    const tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', status)
      )
      .collect();
    const match = tasks.find((task) => task.assignedTo?.toLowerCase() === normalizedRole);
    if (match) return match;
  }
  return null;
}
