import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { readTask } from './read-task';
import { findOpenDeliveryReceipt, markDeliveryReceiptStarted } from './record-task-delivery';

/**
 * Start a task that has an open (not-yet-started) delivery receipt.
 * Reads the task (marking in_progress) and marks the receipt as started.
 */
export async function startTaskFromReceipt(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string },
  taskId: Id<'chatroom_tasks'>
): Promise<boolean> {
  const receipt = await findOpenDeliveryReceipt(ctx, args.chatroomId, args.role, taskId);
  if (!receipt) return false;

  await readTask(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
    taskId,
  });

  await markDeliveryReceiptStarted(ctx, receipt._id);
  return true;
}
