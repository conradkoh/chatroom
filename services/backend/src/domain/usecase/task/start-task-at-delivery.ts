import { readTask } from './read-task';
import { findOpenDeliveryReceipt, markDeliveryReceiptStarted } from './record-task-delivery';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export interface StartTaskAtDeliveryArgs {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  taskId: Id<'chatroom_tasks'>;
}

/** Explicit CLI delivery start: acknowledged → in_progress (+ receipt started if open). */
export async function startTaskAtDelivery(
  ctx: MutationCtx,
  args: StartTaskAtDeliveryArgs
): Promise<void> {
  await readTask(ctx, args);
  const receipt = await findOpenDeliveryReceipt(ctx, args.chatroomId, args.role, args.taskId);
  if (receipt) await markDeliveryReceiptStarted(ctx, receipt._id);
}
