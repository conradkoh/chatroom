/**
 * Frontend-facing harness session endpoints.
 *
 * Called from the web UI to create and manage sessions.
 * The daemon picks up new sessions and processes messages asynchronously.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getNextMessageSeq, requireDirectHarnessWorkers } from '../helpers.js';
import { requireChatroomAccess } from '../../../auth/cliSessionAuth.js';
import { mutation } from '../../../_generated/server.js';

// ─── create ──────────────────────────────────────────────────────────────────

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

    // 1. Validate workspace and chatroom access
    const workspace = await ctx.db.get('chatroom_workspaces', args.workspaceId);
    if (!workspace) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }

    const { session } = await requireChatroomAccess(ctx, args.sessionId, workspace.chatroomId);

    // 2. Validate first message is non-empty
    if (!args.firstMessage.trim()) {
      throw new ConvexError({
        code: 'HARNESS_SESSION_INVALID_PROMPT',
        message: 'firstMessage must not be empty',
      });
    }

    // 3. Insert session row
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

    // 4. Write first user message
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
