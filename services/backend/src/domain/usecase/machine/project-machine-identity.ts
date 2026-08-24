import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function upsertMachineIdentity(ctx: MutationCtx, input: { machineId: string; userId: Id<'users'>; hostname: string }): Promise<void> {
  const existing = await ctx.db.query('chatroom_machineIdentity').withIndex('by_machineId', (q) => q.eq('machineId', input.machineId)).first();
  if (existing?.userId === input.userId && existing.hostname === input.hostname) return;
  if (existing) await ctx.db.patch('chatroom_machineIdentity', existing._id, { userId: input.userId, hostname: input.hostname });
  else await ctx.db.insert('chatroom_machineIdentity', input);
}

export async function deleteMachineIdentity(ctx: MutationCtx, machineId: string): Promise<void> {
  const existing = await ctx.db.query('chatroom_machineIdentity').withIndex('by_machineId', (q) => q.eq('machineId', machineId)).first();
  if (existing) await ctx.db.delete('chatroom_machineIdentity', existing._id);
}
