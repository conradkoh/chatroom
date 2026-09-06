import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/**
 * Canonical write/delete primitives for last-at timestamp projections.
 *
 * Each projection table holds exactly one row per mapping (parent id or
 * stable machineId string) plus its timestamp. Upserts use
 * `Math.max(existing, incoming)` semantics: a retry or delayed migration
 * must never regress the projection. Deletes are idempotent.
 *
 * Slice 1 is additive: legacy `cliSessions.lastUsedAt`,
 * `sessions.lastActivityAt`, and `chatroom_machines.lastSeenAt` remain the
 * authoritative fields until later slices migrate writers/readers.
 */

function assertValidTimestamp(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${field}: expected a finite non-negative number, got ${value}`);
  }
}

export async function upsertCliSessionLastUsedAt(
  ctx: MutationCtx,
  cliSessionId: Id<'cliSessions'>,
  lastUsedAt: number
): Promise<void> {
  assertValidTimestamp(lastUsedAt, 'lastUsedAt');
  const existing = await ctx.db
    .query('chatroom_cliSessionLastUsedAt')
    .withIndex('by_cliSessionId', (q) => q.eq('cliSessionId', cliSessionId))
    .first();
  if (!existing) {
    await ctx.db.insert('chatroom_cliSessionLastUsedAt', { cliSessionId, lastUsedAt });
  } else if (lastUsedAt > existing.lastUsedAt) {
    await ctx.db.patch('chatroom_cliSessionLastUsedAt', existing._id, { lastUsedAt });
  }
}

export async function upsertSessionLastActivityAt(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  lastActivityAt: number
): Promise<void> {
  assertValidTimestamp(lastActivityAt, 'lastActivityAt');
  const existing = await ctx.db
    .query('chatroom_sessionLastActivityAt')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .first();
  if (!existing) {
    await ctx.db.insert('chatroom_sessionLastActivityAt', { sessionId, lastActivityAt });
  } else if (lastActivityAt > existing.lastActivityAt) {
    await ctx.db.patch('chatroom_sessionLastActivityAt', existing._id, { lastActivityAt });
  }
}

export async function upsertMachineLastSeenAt(
  ctx: MutationCtx,
  machineId: string,
  lastSeenAt: number
): Promise<void> {
  assertValidTimestamp(lastSeenAt, 'lastSeenAt');
  const existing = await ctx.db
    .query('chatroom_machineLastSeenAt')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (!existing) {
    await ctx.db.insert('chatroom_machineLastSeenAt', { machineId, lastSeenAt });
  } else if (lastSeenAt > existing.lastSeenAt) {
    await ctx.db.patch('chatroom_machineLastSeenAt', existing._id, { lastSeenAt });
  }
}

export async function deleteCliSessionLastUsedAt(
  ctx: MutationCtx,
  cliSessionId: Id<'cliSessions'>
): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_cliSessionLastUsedAt')
    .withIndex('by_cliSessionId', (q) => q.eq('cliSessionId', cliSessionId))
    .first();
  if (existing) {
    await ctx.db.delete('chatroom_cliSessionLastUsedAt', existing._id);
  }
}

export async function deleteSessionLastActivityAt(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>
): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_sessionLastActivityAt')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .first();
  if (existing) {
    await ctx.db.delete('chatroom_sessionLastActivityAt', existing._id);
  }
}

export async function deleteMachineLastSeenAt(ctx: MutationCtx, machineId: string): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_machineLastSeenAt')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (existing) {
    await ctx.db.delete('chatroom_machineLastSeenAt', existing._id);
  }
}
