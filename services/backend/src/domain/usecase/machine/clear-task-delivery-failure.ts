import { isTaskRoutedToMachine } from './is-task-routed-to-machine';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

function hasExpectedFailureReason(reason: string, expectedReason: string | undefined): boolean {
  return expectedReason === undefined || reason === expectedReason;
}

async function getRoutedTaskDeliveryFailure(
  ctx: MutationCtx,
  args: { taskId: Id<'chatroom_tasks'>; machineId: string }
) {
  const task = await ctx.db.get('chatroom_tasks', args.taskId);
  if (!task) return undefined;
  if (!(await isTaskRoutedToMachine(ctx, task, args.machineId))) return undefined;
  return task.deliveryFailure;
}

export async function clearTaskDeliveryFailure(
  ctx: MutationCtx,
  args: {
    taskId: Id<'chatroom_tasks'>;
    machineId: string;
    expectedReason?: string | undefined;
  }
): Promise<{ cleared: boolean }> {
  const deliveryFailure = await getRoutedTaskDeliveryFailure(ctx, args);
  if (!deliveryFailure || !hasExpectedFailureReason(deliveryFailure.reason, args.expectedReason)) {
    return { cleared: false };
  }
  await ctx.db.patch('chatroom_tasks', args.taskId, { deliveryFailure: undefined });
  return { cleared: true };
}
