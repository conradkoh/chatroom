// fallow-ignore-file code-duplication
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

const MAX_ACK_DELETE_BATCH = 100;

export type AckMachineTaskDeliverySignalsResult = {
  deletedCount: number;
  hasMore: boolean;
};

/**
 * Bounded cleanup for daemon-owned task-delivery signals.
 * Deletes at most MAX_ACK_TASK_DELIVERY_DELETE_BATCH rows at or below
 * `throughSignalKey` within the requested machine/chatroom scope.
 */
export async function ackMachineTaskDeliverySignals(
  ctx: MutationCtx,
  input: { machineId: string; chatroomId: string; throughSignalKey: string }
): Promise<AckMachineTaskDeliverySignalsResult> {
  const rows = await ctx.db
    .query('chatroom_machineTaskDeliverySignals')
    .withIndex('by_machineId_chatroomId_signalKey', (q) =>
      q
        .eq('machineId', input.machineId)
        .eq('chatroomId', input.chatroomId as Id<'chatroom_rooms'>)
        .lte('signalKey', input.throughSignalKey)
    )
    .order('asc')
    .take(MAX_ACK_DELETE_BATCH + 1);
  const batch = rows.slice(0, MAX_ACK_DELETE_BATCH);
  for (const row of batch) {
    await ctx.db.delete('chatroom_machineTaskDeliverySignals', row._id);
  }
  return {
    deletedCount: batch.length,
    hasMore: rows.length > MAX_ACK_DELETE_BATCH,
  };
}
