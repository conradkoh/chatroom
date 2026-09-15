import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function clearTaskDeliveryFailure(
  ctx: MutationCtx,
  args: { taskId: Id<'chatroom_tasks'> }
): Promise<{ cleared: boolean }> {
  const task = await ctx.db.get('chatroom_tasks', args.taskId);
  if (!task?.deliveryFailure) return { cleared: false };
  await ctx.db.patch('chatroom_tasks', args.taskId, { deliveryFailure: undefined });
  return { cleared: true };
}
