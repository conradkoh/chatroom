import type { CommandRunId } from './types';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export type TailPayload = {
  compression: 'gzip';
  content: string;
  byteLength: number;
  totalBytesWritten: number;
  updatedAt: number;
  lineCount: number;
};

export async function getRunTail(
  ctx: QueryCtx | MutationCtx,
  runId: CommandRunId
): Promise<TailPayload | null> {
  const row = await ctx.db
    .query('chatroom_commandRunTailsV2')
    .withIndex('by_runId', (q) => q.eq('runId', runId))
    .first();

  if (!row) return null;

  return {
    compression: row.compression,
    content: row.content,
    byteLength: row.byteLength,
    totalBytesWritten: row.totalBytesWritten,
    updatedAt: row.updatedAt,
    lineCount: row.lineCount,
  };
}

export async function upsertRunTail(
  ctx: MutationCtx,
  args: { runId: CommandRunId; machineId: string; tail: TailPayload }
): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_commandRunTailsV2')
    .withIndex('by_runId', (q) => q.eq('runId', args.runId))
    .first();

  const doc = {
    runId: args.runId,
    machineId: args.machineId,
    compression: args.tail.compression,
    content: args.tail.content,
    byteLength: args.tail.byteLength,
    totalBytesWritten: args.tail.totalBytesWritten,
    updatedAt: args.tail.updatedAt,
    lineCount: args.tail.lineCount,
  };

  if (existing) {
    await ctx.db.patch('chatroom_commandRunTailsV2', existing._id, doc);
    return;
  }

  await ctx.db.insert('chatroom_commandRunTailsV2', doc);
}

export async function deleteRunTail(ctx: MutationCtx, runId: CommandRunId): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_commandRunTailsV2')
    .withIndex('by_runId', (q) => q.eq('runId', runId))
    .first();

  if (existing) {
    await ctx.db.delete('chatroom_commandRunTailsV2', existing._id);
  }
}
