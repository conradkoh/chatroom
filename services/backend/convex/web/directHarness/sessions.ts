/**
 * Web-facing harness session endpoints.
 *
 * Called from the web UI to create sessions and list them.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { requireChatroomAccess } from '../../auth/cliSessionAuth.js';
import { getNextMessageSeq, requireDirectHarnessWorkers } from '../../api/directHarnessHelpers.js';
import { mutation, query } from '../../_generated/server.js';

// ─── create ───────────────────────────────────────────────────────────────────

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
    if (!workspace) throw new ConvexError({ code: 'NOT_FOUND', message: 'Workspace not found' });

    const { session } = await requireChatroomAccess(ctx, args.sessionId, workspace.chatroomId);
    if (!args.firstMessage.trim()) {
      throw new ConvexError({ code: 'HARNESS_SESSION_INVALID_PROMPT', message: 'firstMessage must not be empty' });
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

// ─── listSessions ─────────────────────────────────────────────────────────────

export const listSessions = query({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const sessions = await ctx.db
      .query('chatroom_harnessSessions')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .collect();

    return sessions.map((s) => ({
      _id: s._id,
      status: s.status,
      harnessName: s.harnessName,
      sessionTitle: s.sessionTitle,
      lastUsedConfig: s.lastUsedConfig,
      workspaceId: s.workspaceId,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
    }));
  },
});
