import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { requireMachineWorkspaces } from './machineWorkspaces';
import { mutation, query } from '../../_generated/server';
import {
  getSessionWithAccess,
  requireDirectHarnessWorkers,
  requireOpencodeSession,
} from '../../api/directHarnessHelpers';

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
    const { harnessSession } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionId
    );
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
    const { harnessSession } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionId
    );
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
    const { harnessSession } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionId
    );
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
    const { harnessSession } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionId
    );
    if (harnessSession.status === 'failed' || harnessSession.status === 'closed') return;
    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
      status: 'active',
      lastActiveAt: Date.now(),
    });
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
      harnessName: s.opencode.harnessName,
      opencodeSessionId: s.opencode.opencodeSessionId,
      lastUsedConfig: s.opencode.lastUsedConfig,
      workspaceId: s.workspaceId,
    };
  },
});

// ─── listPendingSessionsForMachine ────────────────────────────────────────────

// fallow-ignore-next-line code-duplication
export const listPendingSessionsForMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const workspaces = await requireMachineWorkspaces(ctx, args.sessionId, args.machineId);
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

// ─── updateSessionTitle ───────────────────────────────────────────────────────

/**
 * Update the session title for a harness session.
 * Called by the daemon when it receives a `session.updated` event from OpenCode
 * carrying a new auto-generated title.
 */
export const updateSessionTitle = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    sessionTitle: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionId
    );
    const s = requireOpencodeSession(harnessSession);

    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
      opencode: {
        ...s.opencode,
        sessionTitle: args.sessionTitle,
      },
    });
  },
});
