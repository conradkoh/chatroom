import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export function buildTimelineTaskStatusSignalKey(
  taskUpdatedAt: number,
  taskId: Doc<'chatroom_tasks'>['_id']
): string {
  return `${String(taskUpdatedAt).padStart(16, '0')}:${taskId}`;
}

export async function writeTimelineTaskStatusSignal(
  ctx: MutationCtx,
  task: Doc<'chatroom_tasks'>
): Promise<void> {
  const taskUpdatedAt = task.updatedAt ?? task.createdAt;
  await ctx.db.insert('chatroom_timelineTaskStatusSignals', {
    chatroomId: task.chatroomId,
    taskId: task._id,
    taskStatus: task.status,
    signalKey: buildTimelineTaskStatusSignalKey(taskUpdatedAt, task._id),
    taskUpdatedAt,
  });
}
