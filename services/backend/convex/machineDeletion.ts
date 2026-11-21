/**
 * Machine deletion cron entrypoints.
 *
 * `purgeBatch` is the scheduler-chained worker started by `machines.deleteMachine`
 * and by the sweeper. `sweepMachineDeletions` (every 5 minutes) restarts chains
 * that died (worker crash, deploy), fails them after too many restarts, and prunes
 * old completed tombstones.
 */

import { v } from 'convex/values';

import {
  MACHINE_DELETION_RETENTION_MS,
  MACHINE_PURGE_MAX_RESTARTS,
  MACHINE_PURGE_STALE_AFTER_MS,
} from '../config/reliability';
import { internal } from './_generated/api';
import type { MutationCtx } from './_generated/server';
import { internalMutation } from './_generated/server';
import { runMachinePurgeBatch } from '../src/domain/usecase/machine/delete-machine';

/** Advance one budgeted machine purge batch and chain the next one. */
export const purgeBatch = internalMutation({
  args: { machineId: v.string() },
  handler: (ctx, args) => runMachinePurgeBatch(ctx, args.machineId),
});

/** Restart dead purge chains, or fail them once they exceed the restart cap. */
async function restartStalledDeletions(ctx: MutationCtx, now: number) {
  const stalled = await ctx.db
    .query('chatroom_machineDeletions')
    .withIndex('by_status_updatedAt', (q) =>
      q.eq('status', 'purging').lt('updatedAt', now - MACHINE_PURGE_STALE_AFTER_MS)
    )
    .take(20);

  for (const deletion of stalled) {
    if (deletion.restartCount >= MACHINE_PURGE_MAX_RESTARTS) {
      await ctx.db.patch('chatroom_machineDeletions', deletion._id, {
        status: 'failed',
        lastError: 'Purge exceeded restart limit',
        updatedAt: now,
      });
      console.error(
        `[MachineDeletion] Purge for machine ${deletion.machineId} failed after ${deletion.restartCount} restarts`
      );
      continue;
    }

    await ctx.db.patch('chatroom_machineDeletions', deletion._id, {
      restartCount: deletion.restartCount + 1,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.machineDeletion.purgeBatch, {
      machineId: deletion.machineId,
    });
  }
}

/** Delete completed tombstones past retention (failed tombstones are kept). */
async function pruneCompletedDeletions(ctx: MutationCtx, now: number) {
  const expired = await ctx.db
    .query('chatroom_machineDeletions')
    .withIndex('by_status_updatedAt', (q) =>
      q.eq('status', 'completed').lt('updatedAt', now - MACHINE_DELETION_RETENTION_MS)
    )
    .take(100);
  for (const deletion of expired) {
    await ctx.db.delete('chatroom_machineDeletions', deletion._id);
  }
  if (expired.length === 100) {
    await ctx.scheduler.runAfter(0, internal.machineDeletion.sweepMachineDeletions, {});
  }
}

/** Cron (5 min): restarts dead purge chains; fails them after MACHINE_PURGE_MAX_RESTARTS; deletes old completed tombstones. */
export const sweepMachineDeletions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    await restartStalledDeletions(ctx, now);
    await pruneCompletedDeletions(ctx, now);
  },
});
