import type { MutationCtx, QueryCtx } from '../../_generated/server';
import type { CompactFileTreeDeltaOp } from '../../lib/fileTreeDeltaOps';

export async function findOperationReceipt(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  workingDir: string,
  operationId: string
) {
  return await ctx.db
    .query('chatroom_workspaceFileTreeDeltaOperation')
    .withIndex('by_machine_workingDir_operationId', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir).eq('operationId', operationId)
    )
    .first();
}
export async function insertDeltaBatch(
  ctx: MutationCtx,
  a: {
    machineId: string;
    workingDir: string;
    baseRevision: number;
    revision: number;
    operations: CompactFileTreeDeltaOp[];
  }
) {
  await ctx.db.insert('chatroom_workspaceFileTreeDelta', a);
}
export async function insertOperationReceipt(
  ctx: MutationCtx,
  a: {
    machineId: string;
    workingDir: string;
    operationId: string;
    revision: number;
    createdAt: number;
  }
) {
  await ctx.db.insert('chatroom_workspaceFileTreeDeltaOperation', a);
}
export async function queryDeltasAfterRevision(
  ctx: QueryCtx,
  machineId: string,
  workingDir: string,
  afterRevision: number,
  limit: number
) {
  return await ctx.db
    .query('chatroom_workspaceFileTreeDelta')
    .withIndex('by_machine_workingDir_revision', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir).gt('revision', afterRevision)
    )
    .take(limit + 1);
}

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
