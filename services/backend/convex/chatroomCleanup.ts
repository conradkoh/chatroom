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
const SMALL_BATCH_SIZE = 200;
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
 */
export const cleanupReadCursors = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cursors = await ctx.db
      .query('chatroom_read_cursors')
      .take(BATCH_SIZE);

    let deleted = 0;
    for (const cursor of cursors) {
      const room = await ctx.db.get(cursor.chatroomId);
      if (!room) {
        await ctx.db.delete(cursor._id);
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log(`[ChatroomCleanup] Deleted ${deleted} orphaned read cursors`);
    }

    // Self-reschedule if we processed a full batch (more may exist)
    if (cursors.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupReadCursors);
    }
  },
});

// ─── Machines Cleanup (90-day inactive) ─────────────────────────────────────

/**
 * Delete machines where lastSeenAt is older than 90 days.
 * Also cleans up related machineLiveness and machineStatus rows.
 */
export const cleanupMachines = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - NINETY_DAYS_MS;

    const oldMachines = await ctx.db
      .query('chatroom_machines')
      .filter((q) => q.lt(q.field('lastSeenAt'), cutoff))
      .take(SMALL_BATCH_SIZE);

    let deleted = 0;
    for (const machine of oldMachines) {
      // Delete related machineLiveness rows
      const livenessRows = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', machine.machineId))
        .collect();
      for (const row of livenessRows) {
        await ctx.db.delete(row._id);
      }

      // Delete related machineStatus rows
      const statusRows = await ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machine.machineId))
        .collect();
      for (const row of statusRows) {
        await ctx.db.delete(row._id);
      }

      await ctx.db.delete(machine._id);
      deleted++;
    }

    if (deleted > 0) {
      console.log(`[ChatroomCleanup] Deleted ${deleted} inactive machines (90d+) and related rows`);
    }

    // Self-reschedule if we hit the batch limit
    if (deleted === SMALL_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupMachines);
    }
  },
});

// ─── Participants Cleanup (orphaned) ────────────────────────────────────────

/**
 * Delete participants where the referenced chatroomId no longer exists.
 */
export const cleanupParticipants = internalMutation({
  args: {},
  handler: async (ctx) => {
    const participants = await ctx.db
      .query('chatroom_participants')
      .take(BATCH_SIZE);

    let deleted = 0;
    for (const participant of participants) {
      const room = await ctx.db.get(participant.chatroomId);
      if (!room) {
        await ctx.db.delete(participant._id);
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log(`[ChatroomCleanup] Deleted ${deleted} orphaned participants`);
    }

    // Self-reschedule if we processed a full batch
    if (participants.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupParticipants);
    }
  },
});

// ─── CLI Sessions Cleanup (inactive) ────────────────────────────────────────

/**
 * Delete CLI sessions that are:
 * - Inactive (isActive === false) AND older than 30 days
 * - OR have lastUsedAt older than 90 days (stale active sessions)
 */
export const cleanupCliSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const inactiveCutoff = Date.now() - THIRTY_DAYS_MS;
    const staleCutoff = Date.now() - NINETY_DAYS_MS;

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

    let deleted = 0;
    for (const session of inactiveSessions) {
      await ctx.db.delete(session._id);
      deleted++;
    }

    // 2. Stale sessions (lastUsedAt > 90 days)
    const staleSessions = await ctx.db
      .query('cliSessions')
      .filter((q) => q.lt(q.field('lastUsedAt'), staleCutoff))
      .take(BATCH_SIZE);

    for (const session of staleSessions) {
      await ctx.db.delete(session._id);
      deleted++;
    }

    if (deleted > 0) {
      console.log(`[ChatroomCleanup] Deleted ${deleted} old/stale CLI sessions`);
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
 */
export const cleanupCompletedTasks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SIXTY_DAYS_MS;

    // Query tasks and filter for terminal statuses with old completedAt
    const oldTasks = await ctx.db
      .query('chatroom_tasks')
      .filter((q) =>
        q.and(
          q.or(
            q.eq(q.field('status'), 'completed'),
            q.eq(q.field('status'), 'closed')
          ),
          q.lt(q.field('completedAt'), cutoff)
        )
      )
      .take(BATCH_SIZE);

    let deleted = 0;
    for (const task of oldTasks) {
      await ctx.db.delete(task._id);
      deleted++;
    }

    // Also clean up very old completed tasks that may not have completedAt set
    // (fallback to _creationTime)
    if (deleted < BATCH_SIZE) {
      const remaining = BATCH_SIZE - deleted;
      const fallbackTasks = await ctx.db
        .query('chatroom_tasks')
        .filter((q) =>
          q.and(
            q.or(
              q.eq(q.field('status'), 'completed'),
              q.eq(q.field('status'), 'closed')
            ),
            q.eq(q.field('completedAt'), undefined),
            q.lt(q.field('_creationTime'), cutoff)
          )
        )
        .take(remaining);

      for (const task of fallbackTasks) {
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
