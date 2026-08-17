import type { MutationCtx } from '../_generated/server';

export async function verifyShardedSnapshotExists(
  ctx: MutationCtx,
  machineId: string,
  workingDir: string,
  id: string
) {
  const row = await ctx.db
    .query('chatroom_workspaceFileTreeManifestV3')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .first();
  return row !== null && row.complete && row.syncGeneration === id;
}
