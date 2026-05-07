import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getAuthenticatedUser } from '../../auth/authenticatedUser.js';
import { getSessionWithAccess, requireDirectHarnessWorkers, requireOpencodeSession } from '../../api/directHarnessHelpers.js';
import { mutation, query } from '../../_generated/server.js';

// ─── appendMessages ──────────────────────────────────────────────────────────

export const appendMessages = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    chunks: v.array(v.object({ content: v.string(), timestamp: v.number() })),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    if (args.chunks.length === 0) return { inserted: 0 };

    // Assign seqs atomically from current max+1 — no collision with user msgs.
    const lastMsg = await ctx.db
      .query('chatroom_harnessSessionMessages')
      .withIndex('by_session_seq', (q) => q.eq('harnessSessionId', args.harnessSessionId))
      .order('desc')
      .first();
    let nextSeq = (lastMsg?.seq ?? 0) + 1;

    for (const chunk of args.chunks) {
      await ctx.db.insert('chatroom_harnessSessionMessages', {
        harnessSessionId: args.harnessSessionId,
        seq: nextSeq++,
        role: 'assistant',
        content: chunk.content,
        timestamp: chunk.timestamp,
      });
    }

    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
      lastActiveAt: Date.now(),
    });

    return { inserted: args.chunks.length };
  },
});

// ─── pendingForMachine ───────────────────────────────────────────────────────

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

    // Only process active/pending sessions — skip closed/failed to prevent
    // endless retries for stale sessions.
    const allSessions = (
      await Promise.all(
        [...workspaceIds].flatMap((wsId) => [
          ctx.db
            .query('chatroom_harnessSessions')
            .withIndex('by_workspace_status', (q) => q.eq('workspaceId', wsId).eq('status', 'pending'))
            .collect(),
          ctx.db
            .query('chatroom_harnessSessions')
            .withIndex('by_workspace_status', (q) => q.eq('workspaceId', wsId).eq('status', 'active'))
            .collect(),
        ])
      )
    ).flat();

    const sessions: Array<{
      _id: string;
      workspaceId: string;
      lastProcessedSeq: number;
      opencodeSessionId: string | undefined;
      lastUsedConfig: { agent: string; model?: { providerID: string; modelID: string } };
    }> = [];
    const allMessages: Array<{ harnessSessionId: string; content: string; seq: number }> = [];

    for (const session of allSessions) {
      const cursor = session.lastProcessedSeq ?? 0;
      const pending = await ctx.db
        .query('chatroom_harnessSessionMessages')
        .withIndex('by_session_role_seq', (q) =>
          q.eq('harnessSessionId', session._id).eq('role', 'user').gt('seq', cursor)
        )
        .order('asc')
        .collect();

      if (pending.length > 0) {
        const s = requireOpencodeSession(session);
        sessions.push({
          _id: session._id as string,
          workspaceId: session.workspaceId as string,
          lastProcessedSeq: cursor,
          // Include opencodeSessionId so the subscriber can detect when
          // the session transitions pending→active without a separate query.
          // When this changes (undefined→string), the subscription re-fires.
          opencodeSessionId: s.opencode.opencodeSessionId,
          lastUsedConfig: s.opencode.lastUsedConfig,
        });
        for (const msg of pending) {
          allMessages.push({
            harnessSessionId: msg.harnessSessionId as unknown as string,
            content: msg.content,
            seq: msg.seq,
          });
        }
      }
    }

    return { sessions, messages: allMessages };
  },
});
