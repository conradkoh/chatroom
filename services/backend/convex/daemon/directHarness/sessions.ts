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

// ─── associateOpenCodeSessionId ───────────────────────────────────────────────

export const associateHarnessSessionId = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    opencodeSessionId: v.string(),
    sessionTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    const existing = harnessSession.opencodeSessionId;
    if (existing === args.opencodeSessionId) return;
    if (existing !== undefined && existing !== null) {
      throw new ConvexError({
        code: 'HARNESS_SESSION_ALREADY_ASSOCIATED',
        message: `Session ${args.harnessSessionId} already has opencodeSessionId '${existing}'.`,
      });
    }

    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
      opencodeSessionId: args.opencodeSessionId,
      status: 'active',
      ...(args.sessionTitle ? { sessionTitle: args.sessionTitle } : {}),
    });
  },
});

// ─── closeSession ─────────────────────────────────────────────────────────────

export const closeSession = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);
    if (harnessSession.status === 'closed') return;
    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
      status: 'closed',
      lastActiveAt: Date.now(),
    });
  },
});

// ─── updateCursor ─────────────────────────────────────────────────────────────

export const updateCursor = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    seq: v.number(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) throw new Error('Authentication required');

    const harnessSession = await ctx.db.get('chatroom_harnessSessions', args.harnessSessionId);
    if (!harnessSession) throw new Error('Session not found');

    const workspace = await ctx.db.get('chatroom_workspaces', harnessSession.workspaceId);
    if (!workspace) throw new Error('Workspace not found');

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', workspace.machineId))
      .first();
    if (!machine || machine.userId !== auth.user._id) throw new Error('Unauthorized');

    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, { lastProcessedSeq: args.seq });
  },
});

// ─── getSession ───────────────────────────────────────────────────────────────

export const getSession = query({
  args: {
    harnessSessionId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const session = await ctx.db.get('chatroom_harnessSessions', args.harnessSessionId);
    if (!session) return null;
    return {
      _id: session._id,
      status: session.status,
      opencodeSessionId: session.opencodeSessionId,
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
          .withIndex('by_workspace_status', (q) =>
            q.eq('workspaceId', workspaceId).eq('status', 'pending')
          )
          .collect()
      )
    );
    return sessionGroups.flat();
  },
});
