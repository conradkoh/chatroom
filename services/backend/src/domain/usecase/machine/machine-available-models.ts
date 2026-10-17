/**
 * Machine available models — the single owner of `chatroom_machineAvailableModels`.
 *
 * The daemon-discovered model catalog is large (~265 KB per machine), so it lives
 * in its own table instead of on `chatroom_machineCapabilities`. That keeps
 * capability-row readers (listMachines, getMachineCapabilities) from paying for it.
 */

import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';

export async function getMachineAvailableModels(
  ctx: QueryCtx | MutationCtx,
  machineId: string
): Promise<Record<string, string[]> | undefined> {
  const row = await ctx.db
    .query('chatroom_machineAvailableModels')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  return row?.availableModels;
}

/** Idempotent. Skips the write when the stored catalog is JSON-equal (no-op writes still invalidate subscriptions). */
export async function upsertMachineAvailableModels(
  ctx: MutationCtx,
  machineId: string,
  availableModels: Record<string, string[]>
): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_machineAvailableModels')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (existing) {
    if (JSON.stringify(existing.availableModels) === JSON.stringify(availableModels)) return;
    await ctx.db.patch('chatroom_machineAvailableModels', existing._id, {
      availableModels,
      updatedAt: Date.now(),
    });
    return;
  }
  await ctx.db.insert('chatroom_machineAvailableModels', {
    machineId,
    availableModels,
    updatedAt: Date.now(),
  });
}

export async function deleteMachineAvailableModels(
  ctx: MutationCtx,
  machineId: string
): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_machineAvailableModels')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (existing) await ctx.db.delete('chatroom_machineAvailableModels', existing._id);
}
