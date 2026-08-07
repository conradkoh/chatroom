import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { acknowledgePendingTask } from '../task/acknowledge-pending-task';
import { readTask } from '../task/read-task';
import { recordTaskDelivery } from '../task/record-task-delivery';

/**
 * Transition the enhancer job's linked task to in_progress when the daemon claims the job.
 *
 * Enhancer is an ephemeral daemon worker — not a chatroom team participant — so this
 * must not go through participants.join / updateTokenActivity.
 */
// fallow-ignore-next-line complexity
export async function startEnhancerJobWork(
  ctx: MutationCtx,
  job: Doc<'chatroom_enhancerJobs'>
): Promise<void> {
  if (!job.taskId) return;

  let task = await ctx.db.get('chatroom_tasks', job.taskId);
  if (!task || task.status === 'completed' || task.status === 'in_progress') return;

  const role = task.assignedTo ?? job.toRole;
  if (!role) return;

  if (task.status === 'pending') {
    await acknowledgePendingTask(ctx, {
      chatroomId: job.chatroomId,
      role,
      pendingTask: task,
    });
    task = (await ctx.db.get('chatroom_tasks', job.taskId)) ?? task;
  }

  if (task.status === 'acknowledged') {
    await readTask(ctx, {
      chatroomId: job.chatroomId,
      role,
      taskId: job.taskId,
    });
  }

  // Record delivery receipt for enhancer claim (startedAt set at claim time)
  await recordTaskDelivery(ctx, {
    chatroomId: job.chatroomId,
    taskId: job.taskId,
    role,
    deliveryKind: 'enhancer_claim',
    jobId: job._id,
    startedAt: Date.now(),
  });
}
