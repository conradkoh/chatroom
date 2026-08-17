import type { MutationCtx, QueryCtx } from '../../_generated/server';

export async function getCurrentRevision(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  workingDir: string
) {
  const delta = await ctx.db
    .query('chatroom_workspaceFileTreeDelta')
    .withIndex('by_machine_workingDir_revision', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .order('desc')
    .first();
  if (delta) return delta.revision;
  const checkpoint = await ctx.db
    .query('chatroom_workspaceFileTreeCheckpoint')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .first();
  return checkpoint?.revision ?? 0;
}
export async function deleteDeltasUpToRevision(
  ctx: MutationCtx,
  machineId: string,
  workingDir: string,
  revision: number
) {
  const rows = await ctx.db
    .query('chatroom_workspaceFileTreeDelta')
    .withIndex('by_machine_workingDir_revision', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir).lte('revision', revision)
    )
    .collect();
  for (const row of rows) await ctx.db.delete('chatroom_workspaceFileTreeDelta', row._id);
  return rows.length;
}
