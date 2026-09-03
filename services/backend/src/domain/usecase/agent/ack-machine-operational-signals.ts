import { reconcileMachineOperationalSignalHead } from './reconcile-machine-operational-signal-head';
import type { MutationCtx } from '../../../../convex/_generated/server';

const MAX_ACK_DELETE_BATCH = 100;

export type AckMachineOperationalSignalsResult = {
  deletedCount: number;
  hasMore: boolean;
};

export async function ackMachineOperationalSignals(
  ctx: MutationCtx,
  input: { machineId: string; throughSignalKey: string }
): Promise<AckMachineOperationalSignalsResult> {
  const rows = await ctx.db
    .query('chatroom_machineOperationalSignals')
    .withIndex('by_machineId_signalKey', (q) =>
      q.eq('machineId', input.machineId).lte('signalKey', input.throughSignalKey)
    )
    .order('asc')
    .take(MAX_ACK_DELETE_BATCH + 1);
  const batch = rows.slice(0, MAX_ACK_DELETE_BATCH);
  for (const row of batch) {
    await ctx.db.delete('chatroom_machineOperationalSignals', row._id);
  }
  if (batch.length > 0) {
    await reconcileMachineOperationalSignalHead(ctx, input.machineId);
  }
  return {
    deletedCount: batch.length,
    hasMore: rows.length > MAX_ACK_DELETE_BATCH,
  };
}
