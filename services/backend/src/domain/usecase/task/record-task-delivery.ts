import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export type DeliveryKind = 'native_inject' | 'enhancer_claim' | 'cli_get_next_task';

export interface RecordTaskDeliveryArgs {
  chatroomId: Id<'chatroom_rooms'>;
  taskId: Id<'chatroom_tasks'>;
  role: string;
  deliveryKind: DeliveryKind;
  harnessSessionId?: string;
  jobId?: Id<'chatroom_enhancerJobs'>;
  startedAt?: number;
}

/**
 * Upsert: if open receipt exists (startedAt undefined), update deliveredAt/harnessSessionId/deliveryKind only.
 * Otherwise insert new receipt.
 */
export async function recordTaskDelivery(
  ctx: MutationCtx,
  args: RecordTaskDeliveryArgs
): Promise<Id<'chatroom_taskDeliveryReceipts'>> {
  const now = Date.now();
  const existing = await findOpenDeliveryReceipt(ctx, args.chatroomId, args.role, args.taskId);

  if (existing) {
    const patch: Record<string, unknown> = {
      deliveredAt: now,
      deliveryKind: args.deliveryKind,
    };
    if (args.harnessSessionId) patch.harnessSessionId = args.harnessSessionId;
    if (args.jobId) patch.jobId = args.jobId;
    if (args.startedAt !== undefined) patch.startedAt = args.startedAt;
    await ctx.db.patch('chatroom_taskDeliveryReceipts', existing._id, patch);
    return existing._id;
  }

  return ctx.db.insert('chatroom_taskDeliveryReceipts', {
    chatroomId: args.chatroomId,
    taskId: args.taskId,
    role: args.role,
    deliveryKind: args.deliveryKind,
    harnessSessionId: args.harnessSessionId,
    jobId: args.jobId,
    deliveredAt: now,
    startedAt: args.startedAt,
  });
}

export async function findOpenDeliveryReceipt(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  taskId: Id<'chatroom_tasks'>
): Promise<Doc<'chatroom_taskDeliveryReceipts'> | null> {
  return ctx.db
    .query('chatroom_taskDeliveryReceipts')
    .withIndex('by_chatroom_role_task', (q) =>
      q.eq('chatroomId', chatroomId).eq('role', role).eq('taskId', taskId)
    )
    .filter((q) => q.eq(q.field('startedAt'), undefined))
    .first();
}

export async function markDeliveryReceiptStarted(
  ctx: MutationCtx,
  receiptId: Id<'chatroom_taskDeliveryReceipts'>
): Promise<void> {
  await ctx.db.patch('chatroom_taskDeliveryReceipts', receiptId, {
    startedAt: Date.now(),
  });
}
