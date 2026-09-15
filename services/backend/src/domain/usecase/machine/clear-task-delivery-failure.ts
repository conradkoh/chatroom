import { isTaskRoutedToMachine } from './is-task-routed-to-machine';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function clearTaskDeliveryFailure(
  ctx: MutationCtx,
  args: { taskId: Id<'chatroom_tasks'>; machineId: string }
): Promise<{ cleared: boolean }> {
  const task = await ctx.db.get('chatroom_tasks', args.taskId);
  if (!task || !(await isTaskRoutedToMachine(ctx, task, args.machineId))) {
    return { cleared: false };
  }
  if (!task.deliveryFailure) return { cleared: false };
  await ctx.db.patch('chatroom_tasks', args.taskId, { deliveryFailure: undefined });
  return { cleared: true };
}
