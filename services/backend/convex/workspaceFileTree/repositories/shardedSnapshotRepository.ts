import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { normalizeWorkingDir } from '../../workspacePathSecurity';

const MAX_SHARD_JSON_BYTES = 800 * 1024;

export type ShardedShardRow = {
  machineId: string;
  workingDir: string;
  shardId: string;
  syncGeneration: string;
  data: { compression: 'gzip'; content: string };
  dataHash: string;
  scannedAt: number;
  entryCount: number;
};

export type ShardedManifestRow = {
  machineId: string;
  workingDir: string;
  syncGeneration: string;
  shardIds: string[];
  totalEntryCount: number;
  complete: boolean;
  scannedAt: number;
};

export type ShardedShardBatchItem = Pick<
  ShardedShardRow,
  'shardId' | 'data' | 'dataHash' | 'scannedAt' | 'entryCount'
>;

export async function findManifest(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  workingDir: string
) {
  return await ctx.db
    .query('chatroom_workspaceFileTreeManifestV3')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .first();
}

export async function findShards(
  ctx: QueryCtx,
  machineId: string,
  workingDir: string,
  syncGeneration: string
) {
  return await ctx.db
    .query('chatroom_workspaceFileTreeShardV3')
    .withIndex('by_machine_workingDir_syncGeneration', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir).eq('syncGeneration', syncGeneration)
    )
    .collect();
}

async function findShardById(
  ctx: MutationCtx,
  machineId: string,
  workingDir: string,
  syncGeneration: string,
  shardId: string
) {
  return await ctx.db
    .query('chatroom_workspaceFileTreeShardV3')
    .withIndex('by_machine_workingDir_syncGeneration_shardId', (q) =>
      q
        .eq('machineId', machineId)
        .eq('workingDir', workingDir)
        .eq('syncGeneration', syncGeneration)
        .eq('shardId', shardId)
    )
    .first();
}

async function writeShardRow(
  ctx: MutationCtx,
  existing: Awaited<ReturnType<typeof findShardById>>,
  row: ShardedShardRow
) {
  if (existing) {
    await ctx.db.patch('chatroom_workspaceFileTreeShardV3', existing._id, row);
  } else {
    await ctx.db.insert('chatroom_workspaceFileTreeShardV3', row);
  }
}

export async function upsertShardRow(ctx: MutationCtx, args: ShardedShardRow): Promise<boolean> {
  const workingDir = normalizeWorkingDir(args.workingDir);
  const sizeBytes = new TextEncoder().encode(args.data.content).length;
  if (sizeBytes > MAX_SHARD_JSON_BYTES) {
    throw new Error(`File tree shard too large: ${args.shardId}`);
  }

  const existing = await findShardById(
    ctx,
    args.machineId,
    workingDir,
    args.syncGeneration,
    args.shardId
  );
  if (existing?.dataHash === args.dataHash) return false;

  await writeShardRow(ctx, existing, { ...args, workingDir });
  return true;
}

export async function upsertShardBatch(
  ctx: MutationCtx,
  machineId: string,
  workingDir: string,
  syncGeneration: string,
  items: ShardedShardBatchItem[]
): Promise<{ written: number; skipped: number }> {
  let written = 0;
  for (const item of items) {
    const didWrite = await upsertShardRow(ctx, {
      machineId,
      workingDir,
      syncGeneration,
      ...item,
    });
    if (didWrite) written++;
  }
  return { written, skipped: items.length - written };
}

async function deleteShardsForGeneration(
  ctx: MutationCtx,
  machineId: string,
  workingDir: string,
  syncGeneration: string
) {
  const shards = await findShards(ctx, machineId, workingDir, syncGeneration);
  for (const shard of shards) {
    await ctx.db.delete('chatroom_workspaceFileTreeShardV3', shard._id);
  }
}

async function writeManifestRow(
  ctx: MutationCtx,
  existing: Awaited<ReturnType<typeof findManifest>>,
  row: ShardedManifestRow
) {
  if (existing) {
    await ctx.db.patch('chatroom_workspaceFileTreeManifestV3', existing._id, row);
  } else {
    await ctx.db.insert('chatroom_workspaceFileTreeManifestV3', row);
  }
}

export async function upsertManifest(ctx: MutationCtx, args: ShardedManifestRow) {
  const workingDir = normalizeWorkingDir(args.workingDir);
  const existing = await findManifest(ctx, args.machineId, workingDir);

  if (existing && existing.syncGeneration !== args.syncGeneration) {
    await deleteShardsForGeneration(ctx, args.machineId, workingDir, existing.syncGeneration);
  }

  await writeManifestRow(ctx, existing, { ...args, workingDir });
}

export async function verifyShardedSnapshotExists(
  ctx: MutationCtx,
  machineId: string,
  workingDir: string,
  syncGeneration: string
): Promise<boolean> {
  const row = await findManifest(ctx, machineId, workingDir);
  return row !== null && row.complete && row.syncGeneration === syncGeneration;
}
