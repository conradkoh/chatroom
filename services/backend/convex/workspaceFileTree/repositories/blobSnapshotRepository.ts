import type { MutationCtx, QueryCtx } from '../../_generated/server';

export type BlobSnapshotRow = {
  machineId: string;
  workingDir: string;
  data: { compression: 'gzip'; content: string };
  dataHash: string;
  scannedAt: number;
};
export async function findBlobSnapshot(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  workingDir: string
) {
  return await ctx.db
    .query('chatroom_workspaceFileTreeV2')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .first();
}
export async function upsertBlobSnapshot(ctx: MutationCtx, row: BlobSnapshotRow) {
  const old = await findBlobSnapshot(ctx, row.machineId, row.workingDir);
  if (old?.dataHash === row.dataHash) return;
  if (old) await ctx.db.patch('chatroom_workspaceFileTreeV2', old._id, row);
  else await ctx.db.insert('chatroom_workspaceFileTreeV2', row);
}
export async function verifyBlobSnapshotExists(
  ctx: MutationCtx,
  machineId: string,
  workingDir: string,
  dataHash: string
) {
  const row = await findBlobSnapshot(ctx, machineId, workingDir);
  return row !== null && row.dataHash === dataHash;
}
