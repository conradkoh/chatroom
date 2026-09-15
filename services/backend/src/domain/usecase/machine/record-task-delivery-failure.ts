import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export type TaskDeliveryFailureReason =
  | 'no_agent_config'
  | 'unsupported_harness'
  | 'injection_not_confirmed'
  | 'task_not_deliverable'
  | 'assigned_elsewhere';

export async function recordTaskDeliveryFailure(
  ctx: MutationCtx,
  args: {
    taskId: Id<'chatroom_tasks'>;
    reason: TaskDeliveryFailureReason;
    occurredAt: number;
  }
): Promise<{ recorded: boolean }> {
  const task = await ctx.db.get('chatroom_tasks', args.taskId);
  if (!task) return { recorded: false };
  if (task.deliveryFailure?.reason === args.reason) return { recorded: false };

  await ctx.db.patch('chatroom_tasks', args.taskId, {
    deliveryFailure: { reason: args.reason, occurredAt: args.occurredAt },
  });
  return { recorded: true };
}
