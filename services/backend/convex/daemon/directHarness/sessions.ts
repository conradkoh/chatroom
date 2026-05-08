import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getAuthenticatedUser } from '../../auth/authenticatedUser.js';
import {
  getSessionWithAccess,
  requireDirectHarnessWorkers,
  requireOpencodeSession,
} from '../../api/directHarnessHelpers.js';
import { mutation, query } from '../../_generated/server.js';

// ─── associateHarnessSessionId ────────────────────────────────────────────────

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
    const s = requireOpencodeSession(harnessSession);

    const existing = s.opencode.opencodeSessionId;
    if (existing === args.opencodeSessionId) return;
    if (existing !== undefined && existing !== null) {
      throw new ConvexError({
        code: 'HARNESS_SESSION_ALREADY_ASSOCIATED',
        message: `Session ${args.harnessSessionId} already has opencodeSessionId '${existing}'.`,
      });
    }

    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
      status: 'active',
      opencode: {
        ...s.opencode,
        opencodeSessionId: args.opencodeSessionId,
        ...(args.sessionTitle ? { sessionTitle: args.sessionTitle } : {}),
      },
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

// ─── markIdle ─────────────────────────────────────────────────────────────────

/**
 * Marks a session as idle (disconnected but resumable).
 * Called by the daemon when a prompt fails or the harness process crashes.
 * The opencode session data still exists on disk and can be resumed.
 */
export const markIdle = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);
    // Don't overwrite terminal statuses.
    if (harnessSession.status === 'failed' || harnessSession.status === 'closed') return;
    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
      status: 'idle',
      isGenerating: false,
      lastActiveAt: Date.now(),
    });
  },
});

// ─── markFailed ───────────────────────────────────────────────────────────────

/**
 * Marks a session as permanently failed.
 * Called when the session is confirmed unrecoverable: workspace not found,
 * opencode returns "session not found", or the session-open failed before
 * an opencodeSessionId was established.
 */
export const markFailed = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);
    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
      status: 'failed',
      isGenerating: false,
      lastActiveAt: Date.now(),
    });
  },
});

// ─── markActive ───────────────────────────────────────────────────────────────

/**
 * Marks a session as active after a successful lazy-resume.
 * Restores the UI to show the session is connected.
 */
export const markActive = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);
    if (harnessSession.status === 'failed' || harnessSession.status === 'closed') return;
    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
      status: 'active',
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
    const s = requireOpencodeSession(session);
    return {
      _id: s._id,
      type: s.type,
      status: s.status,
      isGenerating: s.isGenerating ?? false,
      opencodeSessionId: s.opencode.opencodeSessionId,
      lastUsedConfig: s.opencode.lastUsedConfig,
      lastProcessedSeq: s.lastProcessedSeq,
      workspaceId: s.workspaceId,
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
