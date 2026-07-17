/**
 * Agentic Query Cleanup — TTL-based cleanup for agentic search history.
 *
 * Deletes stale agentic queries (and their turns + run data) older
 * than 7 days by lastActiveAt. Runs hourly via cron with batched, self-rescheduling
 * mutations to stay within Convex write limits.
 */

// fallow-ignore-file complexity

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalMutation } from './_generated/server';
import type { MutationCtx } from './_generated/server';

// ─── Constants ──────────────────────────────────────────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
/** Max queries to attempt per mutation tick. */
const QUERIES_PER_BATCH = 20;
/** Max row deletes per mutation to stay safely within Convex write limits. */
const MAX_DELETES_PER_MUTATION = 300;
const CHILD_ROW_BATCH = 100;

const ACTIVE_STATUSES = new Set(['running', 'pending']);

// ─── Helpers ────────────────────────────────────────────────────────────────

async function deleteAgenticQueryRunData(
  ctx: MutationCtx,
  runId: Id<'chatroom_agenticQueryRuns'>,
  budget: { remaining: number }
): Promise<number> {
  let deleted = 0;

  while (budget.remaining > 0) {
    const messages = await ctx.db
      .query('chatroom_agenticQueryRunMessages')
      .withIndex('by_run', (q) => q.eq('runId', runId))
      .take(CHILD_ROW_BATCH);
    if (messages.length === 0) break;
    for (const row of messages) {
      await ctx.db.delete('chatroom_agenticQueryRunMessages', row._id);
      deleted++;
      budget.remaining--;
      if (budget.remaining <= 0) break;
    }
  }

  while (budget.remaining > 0) {
    const turns = await ctx.db
      .query('chatroom_agenticQueryRunTurns')
      .withIndex('by_run_turnSeq', (q) => q.eq('runId', runId))
      .take(CHILD_ROW_BATCH);
    if (turns.length === 0) break;
    for (const row of turns) {
      await ctx.db.delete('chatroom_agenticQueryRunTurns', row._id);
      deleted++;
      budget.remaining--;
      if (budget.remaining <= 0) break;
    }
  }

  if (budget.remaining > 0) {
    const run = await ctx.db.get('chatroom_agenticQueryRuns', runId);
    if (run) {
      await ctx.db.delete('chatroom_agenticQueryRuns', runId);
      deleted++;
      budget.remaining--;
    }
  }

  return deleted;
}

async function deleteAgenticQueryRuns(
  ctx: MutationCtx,
  agenticQueryId: Id<'chatroom_agenticQueries'>,
  budget: { remaining: number }
): Promise<number> {
  let deleted = 0;

  while (budget.remaining > 0) {
    const runs = await ctx.db
      .query('chatroom_agenticQueryRuns')
      .withIndex('by_agenticQueryId', (q) => q.eq('agenticQueryId', agenticQueryId))
      .take(CHILD_ROW_BATCH);
    if (runs.length === 0) break;
    for (const run of runs) {
      deleted += await deleteAgenticQueryRunData(ctx, run._id, budget);
      if (budget.remaining <= 0) break;
    }
  }

  return deleted;
}

async function deleteAgenticQueryTurns(
  ctx: MutationCtx,
  agenticQueryId: Id<'chatroom_agenticQueries'>,
  budget: { remaining: number }
): Promise<number> {
  let deleted = 0;

  while (budget.remaining > 0) {
    const turns = await ctx.db
      .query('chatroom_agenticQueryTurns')
      .withIndex('by_agenticQueryId', (q) => q.eq('agenticQueryId', agenticQueryId))
      .take(CHILD_ROW_BATCH);
    if (turns.length === 0) break;
    for (const turn of turns) {
      await ctx.db.delete('chatroom_agenticQueryTurns', turn._id);
      deleted++;
      budget.remaining--;
      if (budget.remaining <= 0) break;
    }
  }

  return deleted;
}

async function deleteAgenticQuery(
  ctx: MutationCtx,
  queryId: Id<'chatroom_agenticQueries'>,
  budget: { remaining: number }
): Promise<{ deleted: number; fullyRemoved: boolean }> {
  const query = await ctx.db.get('chatroom_agenticQueries', queryId);
  if (!query) return { deleted: 0, fullyRemoved: true };

  let deleted = 0;
  deleted += await deleteAgenticQueryTurns(ctx, queryId, budget);
  if (budget.remaining <= 0) {
    return { deleted, fullyRemoved: false };
  }

  deleted += await deleteAgenticQueryRuns(ctx, queryId, budget);
  if (budget.remaining <= 0) {
    return { deleted, fullyRemoved: false };
  }

  await ctx.db.delete('chatroom_agenticQueries', queryId);
  deleted++;
  budget.remaining--;
  return { deleted, fullyRemoved: true };
}

// ─── cleanupStaleAgenticQueries ─────────────────────────────────────────────

/**
 * Delete agentic queries with lastActiveAt older than 7 days.
 * Skips running/pending queries. Self-reschedules when batch or delete cap is hit.
 */
export const cleanupStaleAgenticQueries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    const staleQueries = await ctx.db
      .query('chatroom_agenticQueries')
      .withIndex('by_lastActiveAt', (q) => q.lt('lastActiveAt', cutoff))
      .take(QUERIES_PER_BATCH);

    const budget = { remaining: MAX_DELETES_PER_MUTATION };
    let queriesProcessed = 0;
    let queriesFullyRemoved = 0;
    let rowsDeleted = 0;

    for (const query of staleQueries) {
      if (budget.remaining <= 0) break;
      if (ACTIVE_STATUSES.has(query.status)) continue;

      queriesProcessed++;
      const result = await deleteAgenticQuery(ctx, query._id, budget);
      rowsDeleted += result.deleted;
      if (result.fullyRemoved) queriesFullyRemoved++;
      if (budget.remaining <= 0) break;
    }

    if (rowsDeleted > 0) {
      console.log(
        `[AgenticQueryCleanup] Deleted ${rowsDeleted} rows across ${queriesFullyRemoved}/${queriesProcessed} stale queries`
      );
    }

    const shouldReschedule =
      budget.remaining <= 0 || (staleQueries.length === QUERIES_PER_BATCH && queriesProcessed > 0);

    if (shouldReschedule) {
      await ctx.scheduler.runAfter(0, internal.agenticQueryCleanup.cleanupStaleAgenticQueries);
    }
  },
});
