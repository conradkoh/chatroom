/**
 * HarnessSession mutations and queries for the direct-harness feature.
 *
 * Sessions are associated with existing chatroom_workspaces entries (the daemon
 * registers workspaces separately via the daemon workspace registry).
 *
 * All functions require:
 *  1. directHarnessWorkers feature flag enabled
 *  2. Valid SessionIdArg authentication
 *  3. Chatroom membership (resolved via the workspace's chatroomId)
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from '../../_generated/server.js';
import { requireChatroomAccess } from '../../auth/cliSessionAuth.js';
import { getSessionWithAccess, requireDirectHarnessWorkers } from './helpers.js';

// ─── openSession ─────────────────────────────────────────────────────────────

/**
 * Open a new harness session in the given workspace.
 *
 * The workspace must already be registered by the daemon before calling
 * this mutation. Access is verified via the workspace's chatroomId.
 *
 * Returns { harnessSessionRowId } — the backend-issued session row ID.
 */
export const openSession = mutation({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
    harnessName: v.string(),
    /** The agent role opening this session (e.g. 'builder', 'planner'). */
    agent: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new ConvexError({ code: 'NOT_FOUND', message: `Workspace ${args.workspaceId} not found` });
    }

    const { session } = await requireChatroomAccess(ctx, args.sessionId, workspace.chatroomId);

    const now = Date.now();
    const harnessSessionRowId = await ctx.db.insert('chatroom_harnessSessions', {
      workspaceId: args.workspaceId,
      harnessName: args.harnessName,
      harnessSessionId: undefined,
      agent: args.agent,
      status: 'pending',
      createdBy: session.userId,
      createdAt: now,
      lastActiveAt: now,
    });

    return { harnessSessionRowId };
  },
});

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
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionRowId
    );

    // Idempotent: same session already associated
    if (harnessSession.harnessSessionId === args.harnessSessionId) {
      return;
    }

    // Conflict: different session already associated
    if (
      harnessSession.harnessSessionId !== undefined &&
      harnessSession.harnessSessionId !== null
    ) {
      throw new ConvexError(
        `HarnessSession ${args.harnessSessionRowId} already has a different harnessSessionId: ${harnessSession.harnessSessionId}`
      );
    }

    await ctx.db.patch(args.harnessSessionRowId, {
      harnessSessionId: args.harnessSessionId,
      status: 'active',
      lastActiveAt: Date.now(),
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

    if (harnessSession.status === 'closed') {
      return;
    }

    await ctx.db.patch(args.harnessSessionRowId, {
      status: 'closed',
      lastActiveAt: Date.now(),
    });
  },
});

// ─── updateSessionAgent ───────────────────────────────────────────────────────

/**
 * Update the agent associated with a harness session.
 * Used when the session is reassigned to a different role.
 */
export const updateSessionAgent = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
    agent: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionRowId);

    await ctx.db.patch(args.harnessSessionRowId, {
      agent: args.agent,
      lastActiveAt: Date.now(),
    });
  },
});

// ─── getSession ───────────────────────────────────────────────────────────────

/**
 * Fetch a single harness session by its backend row ID.
 */
export const getSession = query({
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
    return harnessSession;
  },
});

// ─── listSessionsByWorkspace ──────────────────────────────────────────────────

/**
 * List all harness sessions for a workspace, ordered by creation time ascending.
 * Optionally filter by status.
 */
export const listSessionsByWorkspace = query({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
    status: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('spawning'),
        v.literal('active'),
        v.literal('idle'),
        v.literal('closed'),
        v.literal('failed')
      )
    ),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    // Verify the workspace exists and the caller has access via chatroom membership
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new ConvexError({ code: 'NOT_FOUND', message: `Workspace ${args.workspaceId} not found` });
    }
    await requireChatroomAccess(ctx, args.sessionId, workspace.chatroomId);

    if (args.status !== undefined) {
      return ctx.db
        .query('chatroom_harnessSessions')
        .withIndex('by_workspace_status', (q) =>
          q.eq('workspaceId', args.workspaceId).eq('status', args.status!)
        )
        .order('asc')
        .collect();
    }

    return ctx.db
      .query('chatroom_harnessSessions')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .order('asc')
      .collect();
  },
});
