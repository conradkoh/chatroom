import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { OperationalSignalTable } from '../machine/list-operational-status-for-machine-signal-range';

const MAX_ACK_DELETE_BATCH = 100;

export type AckMachineOperationalSignalsResult = {
  deletedCount: number;
  hasMore: boolean;
};

export async function ackMachineOperationalSignals(
  ctx: MutationCtx,
  input: { machineId: string; chatroomId: string; throughSignalKey: string },
  signalTable: OperationalSignalTable = 'chatroom_machineAgentOperationalSignals'
): Promise<AckMachineOperationalSignalsResult> {
  const rows = await ctx.db
    .query(signalTable)
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
    await ctx.db.delete(signalTable, row._id);
  }
  return {
    deletedCount: batch.length,
    hasMore: rows.length > MAX_ACK_DELETE_BATCH,
  };
}
