import type { MutationCtx } from '../../../../convex/_generated/server';

export async function ackOrchestrationIngress(
  ctx: MutationCtx,
  ingressId: string
): Promise<{ deleted: boolean }> {
  const row = await ctx.db
    .query('chatroom_orchestrationIngress')
    .withIndex('by_ingressId', (q) => q.eq('ingressId', ingressId))
    .first();
  if (!row) return { deleted: false };
  await ctx.db.delete('chatroom_orchestrationIngress', row._id);
  return { deleted: true };
}
