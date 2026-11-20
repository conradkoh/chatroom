/**
 * Chatroom Cleanup — TTL-based cleanup for chatroom-related tables.
 *
 * Runs as scheduled cron jobs to prevent unbounded growth of tables
 * that accumulate records over time (file trees, cursors, machines,
 * participants, CLI sessions, auth requests, and completed tasks).
 */

import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { deleteCliSessionLastUsedAt } from './lib/lastAtProjections';
import { startMachineDeletion } from '../src/domain/usecase/machine/delete-machine';
import { deleteMachineAvailableModels } from '../src/domain/usecase/machine/machine-available-models';

// ─── Constants ──────────────────────────────────────────────────────────────

const BATCH_SIZE = 500;
/** Max deletes per mutation to stay safely within Convex write limits. */
const MAX_DELETES_PER_MUTATION = 300;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// ─── Workspace File Tree Cleanup (30-day stale) ────────────────────────────

/**
 * Delete workspaceFileTree rows where scannedAt is older than 30 days.
 */
export const cleanupWorkspaceFileTree = internalMutation({
  args: {},
  // fallow-ignore-next-line complexity
  handler: async (ctx) => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    const staleRows = await ctx.db
      .query('chatroom_workspaceFileTree')
      .filter((q) => q.lt(q.field('scannedAt'), cutoff))
      .take(BATCH_SIZE);

    let deleted = 0;
    for (const row of staleRows) {
      await ctx.db.delete('chatroom_workspaceFileTree', row._id);
      deleted++;
    }

    // V2 file trees
    const staleRowsV2 = await ctx.db
      .query('chatroom_workspaceFileTreeV2')
      .filter((q) => q.lt(q.field('scannedAt'), cutoff))
      .take(BATCH_SIZE);
    for (const row of staleRowsV2) {
      await ctx.db.delete('chatroom_workspaceFileTreeV2', row._id);
      deleted++;
    }

    const staleDirListings = await ctx.db
      .query('chatroom_workspaceDirListingV2')
      .filter((q) => q.lt(q.field('scannedAt'), cutoff))
      .take(BATCH_SIZE);
    for (const row of staleDirListings) {
      await ctx.db.delete('chatroom_workspaceDirListingV2', row._id);
      deleted++;
    }

    const staleFileSearches = await ctx.db
      .query('chatroom_workspaceFileSearchV2')
      .filter((q) => q.lt(q.field('scannedAt'), cutoff))
      .take(BATCH_SIZE);
    for (const row of staleFileSearches) {
      await ctx.db.delete('chatroom_workspaceFileSearchV2', row._id);
      deleted++;
    }

    if (deleted > 0) {
      console.warn(`[ChatroomCleanup] Deleted ${deleted} stale workspaceFileTree rows`);
    }

    // Self-reschedule if we hit the batch limit
    if (deleted === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupWorkspaceFileTree);
    }
  },
});

// ─── Read Cursors Cleanup (orphaned) ────────────────────────────────────────

/**
 * Delete read cursors where the referenced chatroomId no longer exists.
 *
 * Uses _creationTime ordering and a cutoff cursor to avoid rescanning
 * the same valid records on every invocation. On each run we process
 * up to BATCH_SIZE records ordered by creation time. If we processed a
 * full batch we reschedule to continue from where we left off (the next
 * cron invocation will start fresh from the beginning again).
 */
export const cleanupReadCursors = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cursors = await ctx.db.query('chatroom_read_cursors').order('asc').take(BATCH_SIZE);

    let deleted = 0;
    for (const cursor of cursors) {
      const room = await ctx.db.get('chatroom_rooms', cursor.chatroomId);
      if (!room) {
        await ctx.db.delete('chatroom_read_cursors', cursor._id);
        deleted++;
        // Cap deletes per mutation to avoid hitting write limits
        if (deleted >= MAX_DELETES_PER_MUTATION) break;
      }
    }

    if (deleted > 0) {
      console.warn(`[ChatroomCleanup] Deleted ${deleted} orphaned read cursors`);
    }

    // Only reschedule if we actually deleted records AND hit our delete cap
    // (meaning there may be more orphans to clean). If no orphans were found
    // in this batch, don't reschedule — avoids infinite loops on valid data.
    if (deleted >= MAX_DELETES_PER_MUTATION) {
      await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupReadCursors);
    }
  },
});

// ─── Machines Cleanup (90-day inactive) ─────────────────────────────────────

/**
 * Delete machines whose dedicated last-seen projection is older than 90 days.
 * The projection index is the source of truth for stale recency.
 *
 * Each stale machine is handed to the shared `startMachineDeletion` use case
 * (the same path as the user-facing `machines.deleteMachine`) with
 * `initiatedBy: 'system'`, `requireOffline: false` and `inlineBudget: 0`, so the
 * tombstone is written and machine authority revoked here, and the purge runs
 * through the scheduler (`machineDeletion.purgeBatch`). What is purged is defined
 * solely by `MACHINE_SCOPED_TABLES`; workspaces are soft-detached, chatrooms and
 * messages are preserved. See memory/architecture/machine-management.md.
 *
 * Orphan projections (capabilities row without a machine) are cleaned inline.
 * At most 50 projections are processed per run; the job reschedules itself if
 * the batch was full.
 */
export const cleanupMachines = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - NINETY_DAYS_MS;

    const oldMachineProjections = await ctx.db
      .query('chatroom_machineCapabilities')
      .withIndex('by_lastSeenAt', (q) => q.lt('lastSeenAt', cutoff))
      .take(50);

    let startedDeletions = 0;
    for (const projection of oldMachineProjections) {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', projection.machineId))
        .first();
      if (!machine) {
        // Orphan projection: parent already gone, just clean the row.
        await ctx.db.delete('chatroom_machineCapabilities', projection._id);
        await deleteMachineAvailableModels(ctx, projection.machineId);
        continue;
      }

      const result = await startMachineDeletion(ctx, {
        machineId: machine.machineId,
        userId: machine.userId,
        initiatedBy: 'system',
        inlineBudget: 0,
        requireOffline: false,
      });
      if (result.status === 'deleted') startedDeletions++;
    }

    if (startedDeletions > 0) {
      console.warn(
        `[ChatroomCleanup] Started deletion of ${startedDeletions} inactive machines (90d+); purge runs via machineDeletion.purgeBatch`
      );
    }

    // Self-reschedule if we hit the batch limit
    if (oldMachineProjections.length === 50) {
      await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupMachines);
    }
  },
});

// ─── Participants Cleanup (orphaned) ────────────────────────────────────────

/**
 * Delete participants where the referenced chatroomId no longer exists.
 *
 * Uses ordered scan with a delete cap to avoid infinite reschedule loops
 * when most records are valid.
 */
export const cleanupParticipants = internalMutation({
  args: {},
  handler: async (ctx) => {
    const participants = await ctx.db.query('chatroom_participants').order('asc').take(BATCH_SIZE);

    let deleted = 0;
    for (const participant of participants) {
      const room = await ctx.db.get('chatroom_rooms', participant.chatroomId);
      if (!room) {
        await ctx.db.delete('chatroom_participants', participant._id);
        deleted++;
        if (deleted >= MAX_DELETES_PER_MUTATION) break;
      }
    }

    if (deleted > 0) {
      console.warn(`[ChatroomCleanup] Deleted ${deleted} orphaned participants`);
    }

    // Only reschedule if we hit the delete cap (more orphans may exist)
    if (deleted >= MAX_DELETES_PER_MUTATION) {
      await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupParticipants);
    }
  },
});

/**
 * Delete CLI sessions that are:
 * - Inactive (isActive === false) AND older than 30 days
 * - OR have a last-used projection older than 90 days (stale active sessions)
 *
 * Uses a Set to track deleted IDs and prevent double-delete between passes.
 */
export const cleanupCliSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const inactiveCutoff = Date.now() - THIRTY_DAYS_MS;
    const staleCutoff = Date.now() - NINETY_DAYS_MS;

    // Track deleted IDs to prevent double-delete across passes
    const deletedIds = new Set<string>();

    // 1. Inactive sessions older than 30 days
    const inactiveSessions = await ctx.db
      .query('cliSessions')
      .filter((q) =>
        q.and(q.eq(q.field('isActive'), false), q.lt(q.field('_creationTime'), inactiveCutoff))
      )
      .take(BATCH_SIZE);

    for (const session of inactiveSessions) {
      await ctx.db.delete('cliSessions', session._id);
      await deleteCliSessionLastUsedAt(ctx, session._id);
      deletedIds.add(session._id);
    }

    // 2. Stale sessions — selected by the dedicated last-used projection
    // index, which is the source of truth for last-use recency.
    // Skip already-deleted ones.
    const staleSessions = await ctx.db
      .query('chatroom_cliSessionLastUsedAt')
      .withIndex('by_lastUsedAt', (q) => q.lt('lastUsedAt', staleCutoff))
      .take(BATCH_SIZE);

    for (const projection of staleSessions) {
      const session = await ctx.db.get('cliSessions', projection.cliSessionId);
      if (!session) {
        // Orphan projection: parent already gone, just clean the row.
        await deleteCliSessionLastUsedAt(ctx, projection.cliSessionId);
        continue;
      }
      if (!deletedIds.has(session._id)) {
        await ctx.db.delete('cliSessions', session._id);
        deletedIds.add(session._id);
      }
      await deleteCliSessionLastUsedAt(ctx, session._id);
    }

    if (deletedIds.size > 0) {
      console.warn(`[ChatroomCleanup] Deleted ${deletedIds.size} old/stale CLI sessions`);
    }

    // Self-reschedule if either query hit batch limit
    if (inactiveSessions.length === BATCH_SIZE || staleSessions.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupCliSessions);
    }
  },
});

// ─── CLI Auth Requests Cleanup (7-day terminal) ────────────────────────────

/**
 * Delete CLI auth requests in terminal status (expired, denied, approved)
 * that are older than 7 days.
 */
export const cleanupCliAuthRequests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;

    const oldRequests = await ctx.db
      .query('cliAuthRequests')
      .filter((q) =>
        q.and(
          q.or(
            q.eq(q.field('status'), 'expired'),
            q.eq(q.field('status'), 'denied'),
            q.eq(q.field('status'), 'approved')
          ),
          q.lt(q.field('_creationTime'), cutoff)
        )
      )
      .take(BATCH_SIZE);

    let deleted = 0;
    for (const request of oldRequests) {
      await ctx.db.delete('cliAuthRequests', request._id);
      deleted++;
    }

    if (deleted > 0) {
      console.warn(`[ChatroomCleanup] Deleted ${deleted} old CLI auth requests`);
    }

    // Self-reschedule if we hit the batch limit
    if (deleted === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupCliAuthRequests);
    }
  },
});

// ─── Completed Tasks Cleanup (60-day terminal) ─────────────────────────────

/**
 * Delete tasks in terminal status (completed, closed) with completedAt
 * older than 60 days. Only targets truly finished tasks.
 *
 * For tasks missing completedAt, falls back to _creationTime.
 */
export const cleanupCompletedTasks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SIXTY_DAYS_MS;

    // Query tasks in terminal statuses that are old enough to clean up.
    // We use _creationTime ordering so the oldest tasks are checked first.
    const candidates = await ctx.db
      .query('chatroom_tasks')
      .order('asc')
      .filter((q) =>
        q.and(
          q.or(q.eq(q.field('status'), 'completed'), q.eq(q.field('status'), 'closed')),
          // Must be old enough by creation time (conservative pre-filter)
          q.lt(q.field('_creationTime'), cutoff)
        )
      )
      .take(BATCH_SIZE);

    let deleted = 0;
    for (const task of candidates) {
      // Use completedAt if available, otherwise fall back to _creationTime
      const taskAge = task.completedAt ?? task._creationTime;
      if (taskAge < cutoff) {
        await ctx.db.delete('chatroom_tasks', task._id);
        deleted++;
      }
    }

    if (deleted > 0) {
      console.warn(`[ChatroomCleanup] Deleted ${deleted} old completed/closed tasks`);
    }

    // Self-reschedule if we hit the batch limit
    if (deleted === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupCompletedTasks);
    }
  },
});
