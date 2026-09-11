import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { omitUndefined } from '../../../../convex/lib/omitUndefined';
import {
  buildTaskStatusSignalKey,
  type TaskTransitionSource,
} from '../../entities/task-status-signal';

/**
 * Sole production entry point for task-status projection writes.
 *
 * Writes the chatroom task-status timeline signal.
 */
export async function writeTaskStatusSignals(
  ctx: MutationCtx,
  task: Doc<'chatroom_tasks'>,
  options?: { source?: TaskTransitionSource | undefined }
): Promise<void> {
  const taskUpdatedAt = task.updatedAt ?? task.createdAt;
  const signalKey = buildTaskStatusSignalKey(taskUpdatedAt, task._id);
  await ctx.db.insert(
    'chatroom_timelineTaskStatusSignals',
    omitUndefined({
      chatroomId: task.chatroomId,
      taskId: task._id,
      taskStatus: task.status,
      signalKey,
      taskUpdatedAt,
      source: options?.source,
    })
  );
}
