import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

type MachineSignal = Pick<Doc<'chatroom_machineTaskStatusSignals'>, 'chatroomId' | 'taskId' | 'targetRole' | 'taskStatus' | 'signalKey' | 'taskUpdatedAt'>;

export async function upsertMachineTaskStatusSignalHead(ctx: MutationCtx, machineId: string, signal: MachineSignal): Promise<void> {
  const existing = await ctx.db.query('chatroom_machineTaskStatusSignalHeads').withIndex('by_machineId', (q) => q.eq('machineId', machineId)).first();
  if (!existing) { await ctx.db.insert('chatroom_machineTaskStatusSignalHeads', { machineId, latestSignal: signal }); return; }
  if (signal.signalKey <= existing.latestSignal.signalKey) return;
  await ctx.db.patch('chatroom_machineTaskStatusSignalHeads', existing._id, { previousSignalKey: existing.latestSignal.signalKey, latestSignal: signal });
}

export async function deleteMachineTaskStatusSignalHead(ctx: MutationCtx, machineId: string): Promise<void> {
  const existing = await ctx.db.query('chatroom_machineTaskStatusSignalHeads').withIndex('by_machineId', (q) => q.eq('machineId', machineId)).first();
  if (existing) await ctx.db.delete('chatroom_machineTaskStatusSignalHeads', existing._id);
}
