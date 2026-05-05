/**
 * Daemon-facing harness session endpoints.
 *
 * Called from the CLI daemon to associate SDK sessions, persist processing
 * cursors, and list pending sessions for machine-level polling.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getAuthenticatedUser } from '../../../auth/authenticatedUser.js';
import { getSessionWithAccess, requireDirectHarnessWorkers } from '../helpers.js';
import { mutation, query } from '../../../_generated/server.js';

// ─── associateHarnessSessionId ────────────────────────────────────────────────

/**
 * Associate the opencode-server-issued harnessSessionId with a session row
 * after the harness process has spawned.
 *
 * Idempotent: if the same harnessSessionId is already set, returns without writing.
 * Throws if a different harnessSessionId is already associated.
 */
export const associateHarnessSessionId = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
    harnessSessionId: v.string(),
    sessionTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionRowId
    );

    const existingId = harnessSession.harnessSessionId;

    // Idempotent: same ID already set — no-op
    if (existingId === args.harnessSessionId) return;

    // Conflict: a different ID is already set
    if (existingId !== undefined && existingId !== null) {
      throw new ConvexError({
        code: 'HARNESS_SESSION_ALREADY_ASSOCIATED',
        message: `Session ${args.harnessSessionRowId} already has harnessSessionId '${existingId}'. Cannot replace with '${args.harnessSessionId}'.`,
      });
    }

    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionRowId, {
      harnessSessionId: args.harnessSessionId,
      status: 'active',
      ...(args.sessionTitle ? { sessionTitle: args.sessionTitle } : {}),
    });
  },
});

// ─── closeSession ─────────────────────────────────────────────────────────────

/**
 * Mark a harness session as closed. Idempotent — closing an already-closed
 * session is a no-op.
 */
export const closeSession = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionRowId
    );

    if (harnessSession.status === 'closed') return;

    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionRowId, {
      status: 'closed',
      lastActiveAt: Date.now(),
    });
  },
});

// ─── updateCursor ─────────────────────────────────────────────────────────────

/**
 * Persist the daemon's processing cursor for a session.
 *
 * Auth: machine ownership (same pattern as publishMachineCapabilities).
 * The daemon calls this after processing a batch of user messages so that
 * on restart it resumes from the correct position.
 */
export const updateCursor = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
    seq: v.number(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) throw new Error('Authentication required');

    const harnessSession = await ctx.db.get('chatroom_harnessSessions', args.harnessSessionRowId);
    if (!harnessSession) throw new Error('Session not found');

    // Verify the machine owns this session's workspace
    const workspace = await ctx.db.get('chatroom_workspaces', harnessSession.workspaceId);
    if (!workspace) throw new Error('Workspace not found');

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', workspace.machineId))
      .first();
    if (!machine || machine.userId !== auth.user._id) {
      throw new Error('Unauthorized');
    }

    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionRowId, {
      lastProcessedSeq: args.seq,
    });
  },
});

// ─── listPendingSessionsForMachine ────────────────────────────────────────────

/**
 * List all pending harness sessions for a machine (for daemon subscription).
 *
 * Returns sessions with status 'pending' that have not yet been picked up by
 * the daemon. Once the daemon calls associateHarnessSessionId, the session
 * transitions to 'active' and no longer appears in this query.
 *
 * Returns [] on auth failure (same pattern as getPendingPromptsForMachine).
 */
export const listPendingSessionsForMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) return [];

    // Look up all workspaces for this machine owned by the authenticated user
    const workspaces = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_machine', (q) => q.eq('machineId', args.machineId))
      .collect();

    if (workspaces.length === 0) return [];

    const workspaceIds = new Set(workspaces.map((w) => w._id));

    // Gather pending sessions for each workspace in parallel
    const sessionGroups = await Promise.all(
      [...workspaceIds].map((workspaceId) =>
        ctx.db
          .query('chatroom_harnessSessions')
          .withIndex('by_workspace_status', (q) =>
            q.eq('workspaceId', workspaceId).eq('status', 'pending')
          )
          .collect()
      )
    );

    // Flatten — all pending sessions are unassociated by definition
    return sessionGroups.flat();
  },
});
