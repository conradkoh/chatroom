/**
 * Harness session endpoints.
 *
 * Frontend-facing: create, closeSession
 * Daemon-facing:  associateHarnessSessionId, updateCursor, listPendingSessionsForMachine
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getAuthenticatedUser } from '../../auth/authenticatedUser.js';
import { requireChatroomAccess } from '../../auth/cliSessionAuth.js';
import { getNextMessageSeq, getSessionWithAccess, requireDirectHarnessWorkers } from './helpers.js';
import { mutation, query } from '../../_generated/server.js';

// ─── create (frontend) ────────────────────────────────────────────────────────

/**
 * Create a new harness session with an initial user message.
 *
 * Inserts the session row (status: 'pending', lastProcessedSeq: 0) and the
 * first user message atomically. The daemon picks up the new session via
 * listPendingSessionsForMachine, opens a harness session, and processes
 * pending messages.
 */
export const create = mutation({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
    harnessName: v.string(),
    config: v.object({
      agent: v.string(),
      model: v.optional(v.object({ providerID: v.string(), modelID: v.string() })),
      system: v.optional(v.string()),
      tools: v.optional(v.record(v.string(), v.boolean())),
    }),
    firstMessage: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const workspace = await ctx.db.get('chatroom_workspaces', args.workspaceId);
    if (!workspace) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }

    const { session } = await requireChatroomAccess(ctx, args.sessionId, workspace.chatroomId);

    if (!args.firstMessage.trim()) {
      throw new ConvexError({
        code: 'HARNESS_SESSION_INVALID_PROMPT',
        message: 'firstMessage must not be empty',
      });
    }

    const now = Date.now();
    const harnessSessionRowId = await ctx.db.insert('chatroom_harnessSessions', {
      workspaceId: args.workspaceId,
      harnessName: args.harnessName,
      harnessSessionId: undefined,
      sessionTitle: undefined,
      lastUsedConfig: args.config,
      status: 'pending',
      lastProcessedSeq: 0,
      createdBy: session.userId,
      createdAt: now,
      lastActiveAt: now,
    });

    const firstSeq = await getNextMessageSeq(ctx, harnessSessionRowId);
    await ctx.db.insert('chatroom_harnessSessionMessages', {
      harnessSessionRowId,
      seq: firstSeq,
      role: 'user',
      content: args.firstMessage.trim(),
      timestamp: now,
    });

    return { sessionId: harnessSessionRowId };
  },
});

// ─── associateHarnessSessionId (daemon) ───────────────────────────────────────

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

    if (existingId === args.harnessSessionId) return;

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

// ─── closeSession (frontend + daemon) ─────────────────────────────────────────

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

// ─── updateCursor (daemon) ────────────────────────────────────────────────────

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
    if (!machine || machine.userId !== auth.user._id) {
      throw new Error('Unauthorized');
    }

    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionRowId, {
      lastProcessedSeq: args.seq,
    });
  },
});

// ─── getSession (daemon) ────────────────────────────────────────────────────

/**
 * Read a harness session by its backend row ID.
 * Returns only the fields the daemon needs.
 */
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

// ─── listPendingSessionsForMachine (daemon) ────────────────────────────────────

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
