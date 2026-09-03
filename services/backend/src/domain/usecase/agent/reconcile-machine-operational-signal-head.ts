// fallow-ignore-file complexity
import type { MutationCtx } from '../../../../convex/_generated/server';

/** Rebuild the two-key head from remaining signals, or delete the head when empty. */
export async function reconcileMachineOperationalSignalHead(
  ctx: MutationCtx,
  machineId: string
): Promise<void> {
  const head = await ctx.db
    .query('chatroom_machineOperationalSignalHeads')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  const latest = await ctx.db
    .query('chatroom_machineOperationalSignals')
    .withIndex('by_machineId_signalKey', (q) => q.eq('machineId', machineId))
    .order('desc')
    .first();
  if (!latest) {
    if (head) await ctx.db.delete('chatroom_machineOperationalSignalHeads', head._id);
    return;
  }
  const previous = await ctx.db
    .query('chatroom_machineOperationalSignals')
    .withIndex('by_machineId_signalKey', (q) =>
      q.eq('machineId', machineId).lt('signalKey', latest.signalKey)
    )
    .order('desc')
    .first();
  const latestSignal = {
    chatroomId: latest.chatroomId,
    role: latest.role,
    revisionKey: latest.revisionKey,
    signalKey: latest.signalKey,
    projectedAt: latest.projectedAt,
    ...(latest.removed ? { removed: true } : {}),
  };
  if (!head) {
    await ctx.db.insert('chatroom_machineOperationalSignalHeads', {
      machineId,
      latestSignal,
      ...(previous ? { previousSignalKey: previous.signalKey } : {}),
    });
    return;
  }
  await ctx.db.patch('chatroom_machineOperationalSignalHeads', head._id, {
    latestSignal,
    previousSignalKey: previous?.signalKey,
  });
}
