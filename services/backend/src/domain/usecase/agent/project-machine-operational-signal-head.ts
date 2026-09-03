import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

type MachineOperationalSignal = Pick<
  Doc<'chatroom_machineOperationalSignals'>,
  'chatroomId' | 'role' | 'revisionKey' | 'signalKey' | 'projectedAt' | 'removed'
>;

export async function upsertMachineOperationalSignalHead(
  ctx: MutationCtx,
  machineId: string,
  signal: MachineOperationalSignal
): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_machineOperationalSignalHeads')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (!existing) {
    await ctx.db.insert('chatroom_machineOperationalSignalHeads', {
      machineId,
      latestSignal: signal,
    });
    return;
  }
  if (signal.signalKey <= existing.latestSignal.signalKey) return;
  await ctx.db.patch('chatroom_machineOperationalSignalHeads', existing._id, {
    previousSignalKey: existing.latestSignal.signalKey,
    latestSignal: signal,
  });
}
