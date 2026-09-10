import { writeTaskDeliverySignal } from './write-task-delivery-signal';
import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { omitUndefined } from '../../../../convex/lib/omitUndefined';
import {
  buildTaskStatusSignalKey,
  type TaskTransitionSource,
} from '../../entities/machine-task-delivery-signal';

/**
 * Sole production entry point for task-status projection writes.
 *
 * Both projections are written in one Convex transaction: a thrown error rolls
 * back the timeline row and the daemon delivery row together.
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
  await writeTaskDeliverySignal(ctx, task, {
    signalKey,
    taskUpdatedAt,
    source: options?.source,
  });
}
