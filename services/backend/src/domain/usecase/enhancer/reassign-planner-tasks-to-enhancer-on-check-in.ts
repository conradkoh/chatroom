import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { collectActiveTasks } from '../task/complete-active-tasks';
import { projectAssignedTaskSnapshotsForChatroom } from '../machine/machine-assigned-task-snapshot-sync';

const ENHANCER_ROLE = 'enhancer';

export async function reassignPlannerTasksToEnhancerOnCheckIn(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<Id<'chatroom_tasks'>[]> {
  const tasks = await collectActiveTasks(ctx, chatroomId, { assignedTo: 'planner' });
  const now = Date.now();
  const reassignedIds: Id<'chatroom_tasks'>[] = [];

  for (const task of tasks) {
    await ctx.db.patch('chatroom_tasks', task._id, {
      assignedTo: ENHANCER_ROLE,
      updatedAt: now,
    });
    reassignedIds.push(task._id);
  }

  if (reassignedIds.length > 0) {
    await projectAssignedTaskSnapshotsForChatroom(ctx, chatroomId);
  }

  return reassignedIds;
}
