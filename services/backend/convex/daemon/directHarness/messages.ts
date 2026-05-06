/**
 * Daemon-facing harness session message endpoints.
 *
 * Called from the CLI daemon to write response chunks and query unprocessed
 * user messages.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getAuthenticatedUser } from '../../auth/authenticatedUser.js';
import { getSessionWithAccess, requireDirectHarnessWorkers } from '../../chatroom/directHarness/helpers.js';
import { mutation, query } from '../../_generated/server.js';

// ─── appendMessages ──────────────────────────────────────────────────────────

export const appendMessages = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
    chunks: v.array(v.object({
      seq: v.number(), content: v.string(), timestamp: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionRowId);

    let inserted = 0, skipped = 0;
    for (const chunk of args.chunks) {
      const existing = await ctx.db
        .query('chatroom_harnessSessionMessages')
        .withIndex('by_session_seq', (q) =>
          q.eq('harnessSessionRowId', args.harnessSessionRowId).eq('seq', chunk.seq))
        .unique();
      if (existing) { skipped++; continue; }

      await ctx.db.insert('chatroom_harnessSessionMessages', {
        harnessSessionRowId: args.harnessSessionRowId,
        seq: chunk.seq, role: 'assistant', content: chunk.content, timestamp: chunk.timestamp,
      });
      inserted++;
    }
    if (inserted > 0) {
      await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionRowId, { lastActiveAt: Date.now() });
    }
    return { inserted, skipped };
  },
});

// ─── pendingForMachine ──────────────────────────────────────────────────────

export const pendingForMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) return { sessions: [], messages: [] };

    const workspaces = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_machine', (q) => q.eq('machineId', args.machineId))
      .collect();
    if (workspaces.length === 0) return { sessions: [], messages: [] };

    const workspaceIds = new Set(workspaces.map((w) => w._id));
    const allSessions = (await Promise.all(
      [...workspaceIds].map((wsId) =>
        ctx.db.query('chatroom_harnessSessions').withIndex('by_workspace', (q) => q.eq('workspaceId', wsId)).collect())
    )).flat();

    const sessions: Array<{ _id: string; workspaceId: string; lastProcessedSeq: number; lastUsedConfig: { agent: string; model?: { providerID: string; modelID: string } } }> = [];
    const allMessages: Array<{ harnessSessionRowId: string; content: string; seq: number }> = [];

    for (const session of allSessions) {
      const cursor = session.lastProcessedSeq ?? 0;
      const pending = await ctx.db
        .query('chatroom_harnessSessionMessages')
        .withIndex('by_session_role_seq', (q) =>
          q.eq('harnessSessionRowId', session._id).eq('role', 'user').gt('seq', cursor))
        .order('asc')
        .collect();

      if (pending.length > 0) {
        sessions.push({
          _id: session._id as string,
          workspaceId: session.workspaceId as string,
          lastProcessedSeq: cursor,
          lastUsedConfig: session.lastUsedConfig,
        });
        for (const msg of pending) {
          allMessages.push({ harnessSessionRowId: msg.harnessSessionRowId as string, content: msg.content, seq: msg.seq });
        }
      }
    }
    return { sessions, messages: allMessages };
  },
});
