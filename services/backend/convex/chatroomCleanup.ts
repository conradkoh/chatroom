/**
 * Chatroom Cleanup — TTL-based cleanup for chatroom-related tables.
 *
 * Runs as scheduled cron jobs to prevent unbounded growth of tables
 * that accumulate records over time (file trees, cursors, machines,
 * participants, CLI sessions, auth requests, and completed tasks).
 */

import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';

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
  handler: async (ctx) => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    const staleRows = await ctx.db
      .query('chatroom_workspaceFileTree')
      .filter((q) => q.lt(q.field('scannedAt'), cutoff))
      .take(BATCH_SIZE);

    let deleted = 0;
    for (const row of staleRows) {
      await ctx.db.delete(row._id);
      deleted++;
    }

    if (deleted > 0) {
      console.log(`[ChatroomCleanup] Deleted ${deleted} stale workspaceFileTree rows`);
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
    const cursors = await ctx.db
      .query('chatroom_read_cursors')
      .order('asc')
      .take(BATCH_SIZE);

    let deleted = 0;
    for (const cursor of cursors) {
      const room = await ctx.db.get(cursor.chatroomId);
      if (!room) {
        await ctx.db.delete(cursor._id);
        deleted++;
        // Cap deletes per mutation to avoid hitting write limits
        if (deleted >= MAX_DELETES_PER_MUTATION) break;
      }
    }

    if (deleted > 0) {
      console.log(`[ChatroomCleanup] Deleted ${deleted} orphaned read cursors`);
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
 * Delete machines where lastSeenAt is older than 90 days.
 * Also cleans up ALL related rows across machine-keyed tables:
 * - chatroom_machineLiveness
 * - chatroom_machineStatus
 * - chatroom_machineModelFilters
 * - chatroom_teamAgentConfigs
 * - chatroom_workspaceGitState
 * - chatroom_workspaceFileTree
 * - chatroom_workspaceFileContent
 * - chatroom_workspaceFullDiff
 * - chatroom_workspaceDiffRequests
 * - chatroom_workspaceFileContentRequests
 * - chatroom_workspaceFileTreeRequests
 * - chatroom_workspaceCommitDetail
 * - chatroom_runnableCommands
 * - chatroom_commandRuns
 * - chatroom_workspaces
 * - chatroom_workspacePRDiffs
 *
 * Due to the large number of related rows per machine, we process
 * only a small batch of machines per invocation.
 */
export const cleanupMachines = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - NINETY_DAYS_MS;

    // Process only a few machines per run (each has many related rows)
    const oldMachines = await ctx.db
      .query('chatroom_machines')
      .filter((q) => q.lt(q.field('lastSeenAt'), cutoff))
      .take(50);

    let deletedMachines = 0;
    for (const machine of oldMachines) {
      const mid = machine.machineId;

      // ── Related rows keyed by machineId (indexed) ──

      const livenessRows = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', mid))
        .collect();
      for (const row of livenessRows) await ctx.db.delete(row._id);

      const statusRows = await ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', mid))
        .collect();
      for (const row of statusRows) await ctx.db.delete(row._id);

      const modelFilters = await ctx.db
        .query('chatroom_machineModelFilters')
        .withIndex('by_machine_harness', (q) => q.eq('machineId', mid))
        .collect();
      for (const row of modelFilters) await ctx.db.delete(row._id);

      const teamConfigs = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_machineId', (q) => q.eq('machineId', mid))
        .collect();
      for (const row of teamConfigs) await ctx.db.delete(row._id);

      const workspaces = await ctx.db
        .query('chatroom_workspaces')
        .withIndex('by_machine', (q) => q.eq('machineId', mid))
        .collect();
      for (const row of workspaces) await ctx.db.delete(row._id);

      // ── Related rows keyed by machineId (filter-based — no direct index) ──
      // These tables use compound indexes with machineId as the first field

      const gitStates = await ctx.db
        .query('chatroom_workspaceGitState')
        .filter((q) => q.eq(q.field('machineId'), mid))
        .collect();
      for (const row of gitStates) await ctx.db.delete(row._id);

      const fileTrees = await ctx.db
        .query('chatroom_workspaceFileTree')
        .filter((q) => q.eq(q.field('machineId'), mid))
        .collect();
      for (const row of fileTrees) await ctx.db.delete(row._id);

      const fileContents = await ctx.db
        .query('chatroom_workspaceFileContent')
        .filter((q) => q.eq(q.field('machineId'), mid))
        .collect();
      for (const row of fileContents) await ctx.db.delete(row._id);

      const fullDiffs = await ctx.db
        .query('chatroom_workspaceFullDiff')
        .filter((q) => q.eq(q.field('machineId'), mid))
        .collect();
      for (const row of fullDiffs) await ctx.db.delete(row._id);

      const prDiffs = await ctx.db
        .query('chatroom_workspacePRDiffs')
        .filter((q) => q.eq(q.field('machineId'), mid))
        .collect();
      for (const row of prDiffs) await ctx.db.delete(row._id);

      const diffRequests = await ctx.db
        .query('chatroom_workspaceDiffRequests')
        .filter((q) => q.eq(q.field('machineId'), mid))
        .collect();
      for (const row of diffRequests) await ctx.db.delete(row._id);

      const fileContentReqs = await ctx.db
        .query('chatroom_workspaceFileContentRequests')
        .filter((q) => q.eq(q.field('machineId'), mid))
        .collect();
      for (const row of fileContentReqs) await ctx.db.delete(row._id);

      const fileTreeReqs = await ctx.db
        .query('chatroom_workspaceFileTreeRequests')
        .filter((q) => q.eq(q.field('machineId'), mid))
        .collect();
      for (const row of fileTreeReqs) await ctx.db.delete(row._id);

      const commitDetails = await ctx.db
        .query('chatroom_workspaceCommitDetail')
        .filter((q) => q.eq(q.field('machineId'), mid))
        .collect();
      for (const row of commitDetails) await ctx.db.delete(row._id);

      const runnableCommands = await ctx.db
        .query('chatroom_runnableCommands')
        .filter((q) => q.eq(q.field('machineId'), mid))
        .collect();
      for (const row of runnableCommands) await ctx.db.delete(row._id);

      const commandRuns = await ctx.db
        .query('chatroom_commandRuns')
        .filter((q) => q.eq(q.field('machineId'), mid))
        .collect();
      for (const row of commandRuns) {
        // Also delete command output chunks for each run
        const chunks = await ctx.db
          .query('chatroom_commandOutput')
          .withIndex('by_runId_chunkIndex', (q) => q.eq('runId', row._id))
          .collect();
        for (const chunk of chunks) await ctx.db.delete(chunk._id);
        await ctx.db.delete(row._id);
      }

      // Finally delete the machine itself
      await ctx.db.delete(machine._id);
      deletedMachines++;
    }

    if (deletedMachines > 0) {
      console.log(`[ChatroomCleanup] Deleted ${deletedMachines} inactive machines (90d+) and all related rows`);
    }

    // Self-reschedule if we hit the batch limit
    if (oldMachines.length === 50) {
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
    const participants = await ctx.db
      .query('chatroom_participants')
      .order('asc')
      .take(BATCH_SIZE);

    let deleted = 0;
    for (const participant of participants) {
      const room = await ctx.db.get(participant.chatroomId);
      if (!room) {
        await ctx.db.delete(participant._id);
        deleted++;
        if (deleted >= MAX_DELETES_PER_MUTATION) break;
      }
    }

    if (deleted > 0) {
      console.log(`[ChatroomCleanup] Deleted ${deleted} orphaned participants`);
    }

    // Only reschedule if we hit the delete cap (more orphans may exist)
    if (deleted >= MAX_DELETES_PER_MUTATION) {
      await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupParticipants);
    }
  },
});

// ─── CLI Sessions Cleanup (inactive) ────────────────────────────────────────

/**
 * Delete CLI sessions that are:
 * - Inactive (isActive === false) AND older than 30 days
 * - OR have lastUsedAt older than 90 days (stale active sessions)
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
        q.and(
          q.eq(q.field('isActive'), false),
          q.lt(q.field('_creationTime'), inactiveCutoff)
        )
      )
      .take(BATCH_SIZE);

    for (const session of inactiveSessions) {
      await ctx.db.delete(session._id);
      deletedIds.add(session._id);
    }

    // 2. Stale sessions (lastUsedAt > 90 days) — skip already-deleted ones
    const staleSessions = await ctx.db
      .query('cliSessions')
      .filter((q) => q.lt(q.field('lastUsedAt'), staleCutoff))
      .take(BATCH_SIZE);

    for (const session of staleSessions) {
      if (!deletedIds.has(session._id)) {
        await ctx.db.delete(session._id);
        deletedIds.add(session._id);
      }
    }

    if (deletedIds.size > 0) {
      console.log(`[ChatroomCleanup] Deleted ${deletedIds.size} old/stale CLI sessions`);
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
      await ctx.db.delete(request._id);
      deleted++;
    }

    if (deleted > 0) {
      console.log(`[ChatroomCleanup] Deleted ${deleted} old CLI auth requests`);
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
          q.or(
            q.eq(q.field('status'), 'completed'),
            q.eq(q.field('status'), 'closed')
          ),
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
        await ctx.db.delete(task._id);
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log(`[ChatroomCleanup] Deleted ${deleted} old completed/closed tasks`);
    }

    // Self-reschedule if we hit the batch limit
    if (deleted === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupCompletedTasks);
    }
  },
});
