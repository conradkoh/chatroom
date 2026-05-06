/**
 * Daemon-facing harness session endpoints.
 *
 * Called from the CLI daemon to associate SDK sessions, persist processing
 * cursors, close sessions, and list pending sessions for machine-level polling.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getAuthenticatedUser } from '../../auth/authenticatedUser.js';
import { getSessionWithAccess, requireDirectHarnessWorkers } from '../../api/directHarnessHelpers.js';
import { mutation, query } from '../../_generated/server.js';

// ─── associateHarnessSessionId ────────────────────────────────────────────────

export const associateHarnessSessionId = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
    harnessSessionId: v.string(),
    sessionTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionRowId);

    const existingId = harnessSession.harnessSessionId;
    if (existingId === args.harnessSessionId) return;
    if (existingId !== undefined && existingId !== null) {
      throw new ConvexError({
        code: 'HARNESS_SESSION_ALREADY_ASSOCIATED',
        message: `Session ${args.harnessSessionRowId} already has harnessSessionId '${existingId}'.`,
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

export const closeSession = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionRowId);
    if (harnessSession.status === 'closed') return;
    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionRowId, {
      status: 'closed',
      lastActiveAt: Date.now(),
    });
  },
});

// ─── updateCursor ─────────────────────────────────────────────────────────────

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

    const workspace = await ctx.db.get('chatroom_workspaces', harnessSession.workspaceId);
    if (!workspace) throw new Error('Workspace not found');

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', workspace.machineId))
      .first();
    if (!machine || machine.userId !== auth.user._id) throw new Error('Unauthorized');

    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionRowId, { lastProcessedSeq: args.seq });
  },
});

// ─── getSession ───────────────────────────────────────────────────────────────

export const getSession = query({
  args: {
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const session = await ctx.db.get('chatroom_harnessSessions', args.harnessSessionRowId);
    if (!session) return null;
    return {
      _id: session._id,
      status: session.status,
      harnessSessionId: session.harnessSessionId,
      lastUsedConfig: session.lastUsedConfig,
      lastProcessedSeq: session.lastProcessedSeq,
      workspaceId: session.workspaceId,
    };
  },
});

// ─── listPendingSessionsForMachine ────────────────────────────────────────────

export const listPendingSessionsForMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) return [];

    const workspaces = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_machine', (q) => q.eq('machineId', args.machineId))
      .collect();
    if (workspaces.length === 0) return [];

    const workspaceIds = new Set(workspaces.map((w) => w._id));
    const sessionGroups = await Promise.all(
      [...workspaceIds].map((workspaceId) =>
        ctx.db
          .query('chatroom_harnessSessions')
          .withIndex('by_workspace_status', (q) => q.eq('workspaceId', workspaceId).eq('status', 'pending'))
          .collect()
      )
    );
    return sessionGroups.flat();
  },
});
