import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { projectAssignedTaskSnapshotsForChatroom } from '../machine/machine-assigned-task-snapshot-sync';

export async function consumeTaskStartInNewSession(ctx: MutationCtx, taskId: Id<'chatroom_tasks'>): Promise<boolean> {
  const task = await ctx.db.get('chatroom_tasks', taskId);
  if (!task?.startInNewSession) return false;
  await ctx.db.patch('chatroom_tasks', taskId, { startInNewSession: undefined, updatedAt: Date.now() });
  await projectAssignedTaskSnapshotsForChatroom(ctx, task.chatroomId);
  return true;
}
