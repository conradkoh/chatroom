/**
 * Storage Cleanup — TTL-based cleanup for temporary data tables.
 *
 * Runs as scheduled cron jobs to prevent unbounded storage growth.
 * Each function processes a batch to stay within mutation limits.
 */

import { internalMutation } from './_generated/server';

// ─── Constants ──────────────────────────────────────────────────────────────

const BATCH_SIZE = 500;
const SMALL_BATCH_SIZE = 200;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// ─── Command Output Cleanup (7-day TTL) ─────────────────────────────────────

/**
 * Delete output chunks for completed/failed/stopped command runs older than 7 days.
 */
export const cleanupCommandOutput = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;

    // Find terminal runs older than 7 days
    const oldRuns = await ctx.db
      .query('chatroom_commandRuns')
      .filter((q) =>
        q.and(
          q.or(
            q.eq(q.field('status'), 'completed'),
            q.eq(q.field('status'), 'failed'),
            q.eq(q.field('status'), 'stopped')
          ),
          q.lt(q.field('_creationTime'), cutoff)
        )
      )
      .take(50); // Process 50 runs per batch

    let deleted = 0;
    for (const run of oldRuns) {
      const chunks = await ctx.db
        .query('chatroom_commandOutput')
        .withIndex('by_runId_chunkIndex', (q) => q.eq('runId', run._id))
        .take(BATCH_SIZE);

      for (const chunk of chunks) {
        await ctx.db.delete(chunk._id);
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log(`[StorageCleanup] Deleted ${deleted} command output chunks`);
    }
  },
});

// ─── Command Runs Cleanup (30-day TTL) ──────────────────────────────────────

/**
 * Delete completed/failed/stopped command runs older than 30 days.
 */
export const cleanupCommandRuns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    const oldRuns = await ctx.db
      .query('chatroom_commandRuns')
      .filter((q) =>
        q.and(
          q.or(
            q.eq(q.field('status'), 'completed'),
            q.eq(q.field('status'), 'failed'),
            q.eq(q.field('status'), 'stopped')
          ),
          q.lt(q.field('_creationTime'), cutoff)
        )
      )
      .take(BATCH_SIZE);

    let deleted = 0;
    for (const run of oldRuns) {
      // Delete any remaining output chunks first
      const chunks = await ctx.db
        .query('chatroom_commandOutput')
        .withIndex('by_runId_chunkIndex', (q) => q.eq('runId', run._id))
        .take(100);
      for (const chunk of chunks) {
        await ctx.db.delete(chunk._id);
      }
      await ctx.db.delete(run._id);
      deleted++;
    }

    if (deleted > 0) {
      console.log(`[StorageCleanup] Deleted ${deleted} old command runs`);
    }
  },
});

// ─── Commit Details Cleanup (30-day TTL) ────────────────────────────────────

/**
 * Delete commit details older than 30 days.
 */
export const cleanupCommitDetails = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    const oldDetails = await ctx.db
      .query('chatroom_workspaceCommitDetail')
      .order('asc')
      .filter((q) => q.lt(q.field('_creationTime'), cutoff))
      .take(BATCH_SIZE);

    let deleted = 0;
    for (const detail of oldDetails) {
      await ctx.db.delete(detail._id);
      deleted++;
    }

    // V2 commit details
    const oldDetailsV2 = await ctx.db
      .query('chatroom_workspaceCommitDetailV2')
      .order('asc')
      .filter((q) => q.lt(q.field('_creationTime'), cutoff))
      .take(BATCH_SIZE);
    for (const detail of oldDetailsV2) {
      await ctx.db.delete(detail._id);
      deleted++;
    }

    if (deleted > 0) {
      console.log(`[StorageCleanup] Deleted ${deleted} old commit details`);
    }
  },
});

// ─── Cached Content Cleanup (24-hour TTL) ───────────────────────────────────

/**
 * Delete on-demand cached content older than 24 hours:
 * - Full diffs
 * - File content
 * - Diff requests (completed/error)
 * - File content requests (completed/error)
 */
export const cleanupCachedContent = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
    let totalDeleted = 0;

    // 1. Full diffs
    const oldDiffs = await ctx.db
      .query('chatroom_workspaceFullDiff')
      .order('asc')
      .filter((q) => q.lt(q.field('_creationTime'), cutoff))
      .take(SMALL_BATCH_SIZE);
    for (const diff of oldDiffs) {
      await ctx.db.delete(diff._id);
      totalDeleted++;
    }

    // 1b. Full diffs V2
    const oldDiffsV2 = await ctx.db
      .query('chatroom_workspaceFullDiffV2')
      .order('asc')
      .filter((q) => q.lt(q.field('_creationTime'), cutoff))
      .take(SMALL_BATCH_SIZE);
    for (const diff of oldDiffsV2) {
      await ctx.db.delete(diff._id);
      totalDeleted++;
    }

    // 2. File content
    const oldContent = await ctx.db
      .query('chatroom_workspaceFileContent')
      .order('asc')
      .filter((q) => q.lt(q.field('_creationTime'), cutoff))
      .take(SMALL_BATCH_SIZE);
    for (const content of oldContent) {
      await ctx.db.delete(content._id);
      totalDeleted++;
    }

    // 2b. File content V2
    const oldContentV2 = await ctx.db
      .query('chatroom_workspaceFileContentV2')
      .order('asc')
      .filter((q) => q.lt(q.field('_creationTime'), cutoff))
      .take(SMALL_BATCH_SIZE);
    for (const contentV2 of oldContentV2) {
      await ctx.db.delete(contentV2._id);
      totalDeleted++;
    }

    // 3. Diff requests
    const oldDiffRequests = await ctx.db
      .query('chatroom_workspaceDiffRequests')
      .order('asc')
      .filter((q) => q.lt(q.field('_creationTime'), cutoff))
      .take(SMALL_BATCH_SIZE);
    for (const req of oldDiffRequests) {
      await ctx.db.delete(req._id);
      totalDeleted++;
    }

    // 4. File content requests
    const oldFileRequests = await ctx.db
      .query('chatroom_workspaceFileContentRequests')
      .order('asc')
      .filter((q) => q.lt(q.field('_creationTime'), cutoff))
      .take(SMALL_BATCH_SIZE);
    for (const req of oldFileRequests) {
      await ctx.db.delete(req._id);
      totalDeleted++;
    }

    if (totalDeleted > 0) {
      console.log(`[StorageCleanup] Deleted ${totalDeleted} cached content records`);
    }
  },
});
