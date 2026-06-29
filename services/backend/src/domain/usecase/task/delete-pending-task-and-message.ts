import { ConvexError } from 'convex/values';

import { adjustTaskCount } from './task-counts';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function deletePendingTaskAndMessage(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    taskId: Id<'chatroom_tasks'>;
    messageId: Id<'chatroom_messages'>;
  }
): Promise<{ success: true }> {
  const task = await ctx.db.get('chatroom_tasks', args.taskId);
  if (!task) {
    return { success: true }; // idempotent
  }
  if (task.status !== 'pending') {
    throw new ConvexError({
      code: 'INVALID_TASK_STATUS',
      message: `Cannot delete task: task is already ${task.status}. Only pending tasks can be deleted.`,
    });
  }
  await ctx.db.delete('chatroom_tasks', args.taskId);
  await adjustTaskCount(ctx, args.chatroomId, 'pending', -1);
  await ctx.db.delete('chatroom_messages', args.messageId);
  return { success: true };
}

/** Resolve the primary user message for a pending task (non-progress). */
export async function findPrimaryMessageForTask(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>
): Promise<{ _id: Id<'chatroom_messages'>; chatroomId: Id<'chatroom_rooms'> } | null> {
  const messages = await ctx.db
    .query('chatroom_messages')
    .withIndex('by_taskId', (q) => q.eq('taskId', taskId))
    .collect();
  const primary =
    messages.find((m) => m.type === 'message') ??
    messages.find((m) => m.type !== 'progress') ??
    messages[0];
  if (!primary) return null;
  return { _id: primary._id, chatroomId: primary.chatroomId };
}
