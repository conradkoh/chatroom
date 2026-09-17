import { ConvexError } from 'convex/values';

import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';

/**
 * Loads the task backing an enhancer job, validating the job–task binding.
 *
 * Throws `NOT_FOUND` when the job has no linked task, and `TASK_NOT_FOUND`
 * when the linked task is missing or belongs to a different chatroom.
 */
export async function loadEnhancerJobTask(
  ctx: QueryCtx,
  job: Doc<'chatroom_enhancerJobs'>
): Promise<Doc<'chatroom_tasks'>> {
  if (!job.taskId) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: 'Enhancer job missing linked task',
    });
  }

  const task = await ctx.db.get('chatroom_tasks', job.taskId);
  if (!task || task.chatroomId !== job.chatroomId) {
    throw new ConvexError({ code: 'TASK_NOT_FOUND', message: 'Linked enhancer task not found' });
  }

  return task;
}
