/**
 * Web-facing harness session endpoints.
 *
 * Called from the web UI to create sessions and list them.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from '../../_generated/server';
import {
  requireDirectHarnessWorkers,
  requireOpencodeSession,
} from '../../api/directHarnessHelpers';
import { requireChatroomAccess } from '../../auth/chatroomAccess';
import { insertUserTurn } from '../../daemon/directHarness/insertUserTurn';

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
      throw new ConvexError({
        code: 'HARNESS_SESSION_INVALID_PROMPT',
        message: 'firstMessage must not be empty',
      });
    }

    const now = Date.now();
    const harnessSessionId = await ctx.db.insert('chatroom_harnessSessions', {
      type: 'opencode',
      workspaceId: args.workspaceId,
      status: 'pending',
      createdBy: session.userId,
      createdAt: now,
      lastActiveAt: now,
      opencode: {
        harnessName: args.harnessName,
        opencodeSessionId: undefined,
        sessionTitle: undefined,
        lastUsedConfig: args.config,
      },
    });

    await insertUserTurn(ctx, harnessSessionId, args.firstMessage, now);

    return { sessionId: harnessSessionId };
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

    return sessions.map((s) => {
      const o = requireOpencodeSession(s);
      return {
        _id: s._id,
        status: s.status,
        harnessName: o.opencode.harnessName,
        sessionTitle: o.opencode.sessionTitle,
        lastUsedConfig: o.opencode.lastUsedConfig,
        workspaceId: s.workspaceId,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
      };
    });
  },
});

// ─── renameSession ────────────────────────────────────────────────────────────

const MAX_SESSION_TITLE_LENGTH = 200;

function validateTrimmedSessionTitle(sessionTitle: string): string {
  const trimmed = sessionTitle.trim();
  if (!trimmed) {
    throw new ConvexError({
      code: 'HARNESS_SESSION_INVALID_TITLE',
      message: 'Title must not be empty',
    });
  }
  if (trimmed.length > MAX_SESSION_TITLE_LENGTH) {
    throw new ConvexError({
      code: 'HARNESS_SESSION_INVALID_TITLE',
      message: `Title must be at most ${MAX_SESSION_TITLE_LENGTH} characters`,
    });
  }
  return trimmed;
}

/** User-facing rename — updates the stored session title in Convex only (no SDK sync). */
export const renameSession = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    sessionTitle: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const trimmed = validateTrimmedSessionTitle(args.sessionTitle);

    const harnessSession = await ctx.db.get('chatroom_harnessSessions', args.harnessSessionId);
    if (!harnessSession) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Session not found' });
    }

    const workspace = await ctx.db.get('chatroom_workspaces', harnessSession.workspaceId);
    if (!workspace) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }

    await requireChatroomAccess(ctx, args.sessionId, workspace.chatroomId);

    const s = requireOpencodeSession(harnessSession);
    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
      opencode: {
        ...s.opencode,
        sessionTitle: trimmed,
      },
      lastActiveAt: Date.now(),
    });
  },
});
