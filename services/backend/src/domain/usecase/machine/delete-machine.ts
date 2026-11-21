/**
 * Machine deletion — tombstone-first, budgeted and resumable.
 *
 * ## Safety property
 *
 * Every daemon mutation authorizes through `requireMachineOwner` → `checkAccess`,
 * which reads the `chatroom_machines` row. `startMachineDeletion` inserts the
 * tombstone and deletes that row in the SAME transaction that proves the machine
 * is offline, so heartbeats, command claims and status writes are revoked
 * atomically. Only `machines.register` can recreate the row, and it refuses while
 * a `purging` tombstone exists.
 *
 * ## What survives
 *
 * Workspaces are soft-detached (`removedAt`) with their primary-workspace pointer
 * removed; chatrooms, messages and participants are untouched. Everything else
 * machine-keyed is purged by `MACHINE_SCOPED_TABLES` in budgeted batches.
 */

import { ConvexError } from 'convex/values';

import { purgeMachineBatch } from './machine-scoped-tables';
import { getMachineUsage, type MachineUsage } from './machine-usage';
import { BACKEND_ERROR_CODES } from '../../../../config/errorCodes';
import { internal } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export interface StartMachineDeletionInput {
  machineId: string;
  initiatedBy: 'user' | 'system';
  /** Machine owner. The caller is responsible for the ownership check. */
  userId: Id<'users'>;
  /** Work done in the calling transaction: MACHINE_PURGE_BUDGET for users, 0 for system. */
  inlineBudget: number;
  /** Users may only delete offline machines; the 90-day cleanup runs with false. */
  requireOffline: boolean;
}

export type StartMachineDeletionResult =
  | {
      status: 'deleted';
      purgeComplete: boolean;
      detachedWorkspaceCount: number;
      affectedChatroomCount: number;
    }
  | { status: 'already_deleted' };

/** Latest tombstone for a machine, if any. */
async function latestDeletion(ctx: MutationCtx, machineId: string) {
  return ctx.db
    .query('chatroom_machineDeletions')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .order('desc')
    .first();
}

/** Result of the guard phase: either a deletable target or the idempotent repeat. */
type DeletionTarget =
  | { status: 'already_deleted' }
  | {
      status: 'deletable';
      machineRowId: Id<'chatroom_machines'>;
      usage: MachineUsage;
    };

/** Ownership guard for the tombstone owner. */
function assertOwnedByUser(machineUserId: Id<'users'>, userId: Id<'users'>): void {
  // Defensive: callers check ownership first, but the tombstone must never be
  // claimed by a user other than the machine owner.
  if (machineUserId !== userId) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.NOT_AUTHORIZED_MACHINE,
      message: 'Not authorized for this machine',
    });
  }
}

/** Offline guard for user-initiated deletions. Missing status counts as offline. */
async function assertMachineOffline(ctx: MutationCtx, machineId: string): Promise<void> {
  const status = await ctx.db
    .query('chatroom_machineStatus')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (status?.status === 'online') {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.MACHINE_ONLINE,
      message: 'Stop the daemon on this machine first',
    });
  }
}

/** Ownership and (optional) offline guard. Throws ConvexError with the UI-facing code. */
async function assertDeletionAllowed(
  ctx: MutationCtx,
  machine: { userId: Id<'users'> },
  input: StartMachineDeletionInput
): Promise<void> {
  assertOwnedByUser(machine.userId, input.userId);
  if (!input.requireOffline) return;
  await assertMachineOffline(ctx, input.machineId);
}

async function resolveDeletionTarget(
  ctx: MutationCtx,
  input: StartMachineDeletionInput
): Promise<DeletionTarget> {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', input.machineId))
    .first();

  if (!machine) {
    const deletion = await latestDeletion(ctx, input.machineId);
    if (deletion && deletion.userId === input.userId) {
      return { status: 'already_deleted' };
    }
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.MACHINE_NOT_FOUND,
      message: 'Machine not found',
    });
  }

  await assertDeletionAllowed(ctx, machine, input);

  // Active workspace/chatroom counts are toast-only and capped at 500.
  return {
    status: 'deletable',
    machineRowId: machine._id,
    usage: await getMachineUsage(ctx, input.machineId),
  };
}

/**
 * Tombstone-first: deleting the machine row revokes every daemon mutation. The
 * status/liveness/capability projections are removed alongside it so a stale
 * "online" row cannot resurrect the machine in the UI.
 */
async function revokeMachineAuthority(
  ctx: MutationCtx,
  machineRowId: Id<'chatroom_machines'>,
  machineId: string
): Promise<void> {
  await ctx.db.delete('chatroom_machines', machineRowId);
  for (const table of [
    'chatroom_machineStatus',
    'chatroom_machineLiveness',
    'chatroom_machineCapabilities',
    'chatroom_machineAvailableModels',
  ] as const) {
    const row = await ctx.db
      .query(table)
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first();
    if (row) await ctx.db.delete(table, row._id);
  }
}

/** Persist batch counters and optionally close the tombstone. */
async function recordBatchProgress(
  ctx: MutationCtx,
  deletionId: Id<'chatroom_machineDeletions'>,
  counters: {
    batchCount: number;
    deletedRowCount: number;
    detachedWorkspaceCount: number;
  },
  completedAt?: number
): Promise<void> {
  const updatedAt = completedAt ?? Date.now();
  await ctx.db.patch('chatroom_machineDeletions', deletionId, {
    ...counters,
    updatedAt,
    ...(completedAt !== undefined ? { status: 'completed' as const, completedAt } : {}),
  });
}

/**
 * Start (or repeat) a machine deletion. One transaction: guards, tombstone,
 * authority revocation, inline purge slice, follow-up scheduling.
 */
export async function startMachineDeletion(
  ctx: MutationCtx,
  input: StartMachineDeletionInput
): Promise<StartMachineDeletionResult> {
  const guard = await resolveDeletionTarget(ctx, input);
  if (guard.status === 'already_deleted') return { status: 'already_deleted' };

  const now = Date.now();
  const deletionId = await ctx.db.insert('chatroom_machineDeletions', {
    machineId: input.machineId,
    userId: input.userId,
    initiatedBy: input.initiatedBy,
    status: 'purging',
    requestedAt: now,
    updatedAt: now,
    batchCount: 0,
    restartCount: 0,
    deletedRowCount: 0,
    detachedWorkspaceCount: 0,
  });
  await revokeMachineAuthority(ctx, guard.machineRowId, input.machineId);

  const result = {
    status: 'deleted' as const,
    detachedWorkspaceCount: guard.usage.activeWorkspaceCount,
    affectedChatroomCount: guard.usage.activeChatroomCount,
  };

  if (input.inlineBudget <= 0) {
    await ctx.scheduler.runAfter(0, internal.machineDeletion.purgeBatch, {
      machineId: input.machineId,
    });
    return { ...result, purgeComplete: false };
  }

  const batch = await purgeMachineBatch(
    ctx,
    { machineId: input.machineId, userId: input.userId },
    input.inlineBudget
  );
  const counters = {
    batchCount: 1,
    deletedRowCount: batch.deleted,
    detachedWorkspaceCount: batch.detached,
  };

  if (batch.drained) {
    await recordBatchProgress(ctx, deletionId, counters, Date.now());
    return { ...result, purgeComplete: true };
  }

  await recordBatchProgress(ctx, deletionId, counters);
  await ctx.scheduler.runAfter(0, internal.machineDeletion.purgeBatch, {
    machineId: input.machineId,
  });
  return { ...result, purgeComplete: false };
}

/**
 * Advance one scheduled purge batch. Idempotent: returns `{ done: true }` when the
 * tombstone is missing or no longer `purging`. Marks the tombstone `completed` on
 * the empty verification pass.
 */
export async function runMachinePurgeBatch(
  ctx: MutationCtx,
  machineId: string
): Promise<{ done: boolean }> {
  const deletion = await latestDeletion(ctx, machineId);
  if (!deletion || deletion.status !== 'purging') return { done: true };

  const batch = await purgeMachineBatch(ctx, { machineId, userId: deletion.userId });
  const now = Date.now();
  const counters = {
    batchCount: deletion.batchCount + 1,
    deletedRowCount: deletion.deletedRowCount + batch.deleted,
    detachedWorkspaceCount: deletion.detachedWorkspaceCount + batch.detached,
    updatedAt: now,
  };

  if (batch.drained) {
    await ctx.db.patch('chatroom_machineDeletions', deletion._id, {
      ...counters,
      status: 'completed',
      completedAt: now,
    });
    return { done: true };
  }

  await ctx.db.patch('chatroom_machineDeletions', deletion._id, counters);
  await ctx.scheduler.runAfter(0, internal.machineDeletion.purgeBatch, { machineId });
  return { done: false };
}
