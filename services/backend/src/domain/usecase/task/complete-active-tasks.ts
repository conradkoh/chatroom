import { transitionTask } from './transition-task';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export interface CompleteActiveTasksOptions {
  skipAutoPromotion?: boolean;
}

export async function collectActiveTasks(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  filter?: { assignedTo?: string }
): Promise<Doc<'chatroom_tasks'>[]> {
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

  let tasks = [...inProgress, ...acknowledged];
  if (filter?.assignedTo) {
    const role = filter.assignedTo.toLowerCase();
    tasks = tasks.filter((t) => t.assignedTo?.toLowerCase() === role);
  }
  return tasks;
}

export async function completeTasks(
  ctx: MutationCtx,
  tasks: Doc<'chatroom_tasks'>[],
  options?: CompleteActiveTasksOptions
): Promise<Id<'chatroom_tasks'>[]> {
  const completedIds: Id<'chatroom_tasks'>[] = [];
  const now = Date.now();
  const skipAutoPromotion = options?.skipAutoPromotion ?? true;

  for (const task of tasks) {
    const trigger = task.status === 'pending' ? 'completeTaskById' : 'completeTask';
    await transitionTask(ctx, task._id, 'completed', trigger, undefined, {
      skipAutoPromotion,
    });
    completedIds.push(task._id);
    if (task.sourceMessageId) {
      await ctx.db.patch('chatroom_messages', task.sourceMessageId, { completedAt: now });
    }
  }
  return completedIds;
}

export async function completeActiveTasksForRole(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  assignedTo: string,
  options?: CompleteActiveTasksOptions
): Promise<Id<'chatroom_tasks'>[]> {
  const tasks = await collectActiveTasks(ctx, chatroomId, { assignedTo });
  return completeTasks(ctx, tasks, options);
}
