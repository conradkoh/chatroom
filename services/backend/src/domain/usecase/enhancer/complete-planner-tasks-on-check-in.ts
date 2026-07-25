import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { transitionTask } from '../task/transition-task';

export async function completePlannerTasksOnEnhancerCheckIn(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<Id<'chatroom_tasks'>[]> {
  const [inProgress, acknowledged] = await Promise.all([
    ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', 'in_progress')
      )
      .collect(),
    ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', 'acknowledged')
      )
      .collect(),
  ]);

  const plannerTasks = [...inProgress, ...acknowledged].filter(
    (t) => t.assignedTo?.toLowerCase() === 'planner'
  );

  const completedIds: Id<'chatroom_tasks'>[] = [];
  const now = Date.now();

  for (const task of plannerTasks) {
    const trigger = task.status === 'pending' ? 'completeTaskById' : 'completeTask';
    await transitionTask(ctx, task._id, 'completed', trigger, undefined, {
      skipAutoPromotion: true,
    });
    completedIds.push(task._id);
    if (task.sourceMessageId) {
      await ctx.db.patch('chatroom_messages', task.sourceMessageId, { completedAt: now });
    }
  }

  return completedIds;
}
