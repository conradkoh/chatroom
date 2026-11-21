import { isTaskRoutedToMachine } from './is-task-routed-to-machine';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

type ClearableDeliveryFailureReason = 'task_not_deliverable' | 'delivery_retrying';

/**
 * An unconditional clear resolves transport failures only. A `delivery_retrying`
 * warning is resolved solely by an explicit clear: a successful injection is not a
 * successful turn, so an unconditional clear would flap the warning on every retry.
 */
function hasExpectedFailureReason(
  reason: string,
  expectedReason: ClearableDeliveryFailureReason | undefined
): boolean {
  if (expectedReason === undefined) return reason !== 'delivery_retrying';
  return reason === expectedReason;
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
    expectedReason?: ClearableDeliveryFailureReason | undefined;
  }
): Promise<{ cleared: boolean }> {
  const deliveryFailure = await getRoutedTaskDeliveryFailure(ctx, args);
  if (!deliveryFailure || !hasExpectedFailureReason(deliveryFailure.reason, args.expectedReason)) {
    return { cleared: false };
  }
  await ctx.db.patch('chatroom_tasks', args.taskId, { deliveryFailure: undefined });
  return { cleared: true };
}
