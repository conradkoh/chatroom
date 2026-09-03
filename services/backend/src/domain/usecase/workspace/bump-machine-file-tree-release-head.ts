import type { MutationCtx } from '../../../../convex/_generated/server';

/** Bump the machine-level wake-up revision for newly queued release work. */
export async function bumpMachineFileTreeReleaseHead(
  ctx: MutationCtx,
  machineId: string
): Promise<number> {
  const existing = await ctx.db
    .query('chatroom_machineFileTreeReleaseHeads')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  const now = Date.now();
  const revision = (existing?.revision ?? 0) + 1;
  if (existing) {
    await ctx.db.patch('chatroom_machineFileTreeReleaseHeads', existing._id, {
      revision,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert('chatroom_machineFileTreeReleaseHeads', {
      machineId,
      revision,
      updatedAt: now,
    });
  }
  return revision;
}
