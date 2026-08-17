import type { MutationCtx, QueryCtx } from '../../_generated/server';
import type { FileTreeCheckpointRow } from '../types';

export async function findCheckpoint(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  workingDir: string
) {
  return await ctx.db
    .query('chatroom_workspaceFileTreeCheckpoint')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .first();
}
export async function upsertCheckpoint(ctx: MutationCtx, row: FileTreeCheckpointRow) {
  const existing = await findCheckpoint(ctx, row.machineId, row.workingDir);
  if (existing) {
    await ctx.db.patch('chatroom_workspaceFileTreeCheckpoint', existing._id, row);
    return existing._id;
  }
  return await ctx.db.insert('chatroom_workspaceFileTreeCheckpoint', row);
}
