import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from '../../_generated/server';
import {
  getSessionWithAccess,
  requireDirectHarnessWorkers,
  requireOpencodeSession,
} from '../../api/directHarnessHelpers';
import { requireMachineOwner } from '../../auth/cli/machineAccess';

// ─── appendMessages ──────────────────────────────────────────────────────────

export const appendMessages = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    chunks: v.array(
      v.object({
        content: v.string(),
        timestamp: v.number(),
        messageId: v.optional(v.string()),
        partType: v.optional(v.union(v.literal('text'), v.literal('reasoning'))),
      })
    ),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    if (args.chunks.length === 0) return { inserted: 0 };

    // Insert chunks without manual seq. Convex's _creationTime orders chunks
    // across mutations (mutations are serialized). Within a single mutation,
    // inserts may share the same _creationTime; the frontend handles this via
    // per-chunk _id deduplication, not a _creationTime high-water mark.
    for (const chunk of args.chunks) {
      await ctx.db.insert('chatroom_harnessSessionMessages', {
        harnessSessionId: args.harnessSessionId,
        role: 'assistant',
        content: chunk.content,
        timestamp: chunk.timestamp,
        messageId: chunk.messageId,
        partType: chunk.partType,
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
    await requireMachineOwner(ctx, args.sessionId, args.machineId);

    const workspaces = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_machine', (q) => q.eq('machineId', args.machineId))
      .collect();
    if (workspaces.length === 0) return { sessions: [], messages: [] };

    const workspaceIds = new Set(workspaces.map((w) => w._id));

    // Only process resumable sessions — skip closed/failed to prevent
    // endless retries for stale sessions. Include idle so disconnected
    // sessions with queued messages can be lazily resumed.
    const allSessions = (
      await Promise.all(
        [...workspaceIds].flatMap((wsId) => [
          ctx.db
            .query('chatroom_harnessSessions')
            .withIndex('by_workspace_status', (q) =>
              q.eq('workspaceId', wsId).eq('status', 'pending')
            )
            .collect(),
          ctx.db
            .query('chatroom_harnessSessions')
            .withIndex('by_workspace_status', (q) =>
              q.eq('workspaceId', wsId).eq('status', 'active')
            )
            .collect(),
          ctx.db
            .query('chatroom_harnessSessions')
            .withIndex('by_workspace_status', (q) => q.eq('workspaceId', wsId).eq('status', 'idle'))
            .collect(),
        ])
      )
    ).flat();

    const sessions: {
      _id: string;
      workspaceId: string;
      harnessName: string;
      opencodeSessionId: string | undefined;
      lastUsedConfig: { agent: string; model?: { providerID: string; modelID: string } };
    }[] = [];
    const allMessages: { harnessSessionId: string; content: string; seq: number }[] = [];

    for (const session of allSessions) {
      const cursor = session.lastProcessedTurnSeq ?? 0;
      const pendingTurns = await ctx.db
        .query('chatroom_harnessSessionTurns')
        .withIndex('by_session_turnSeq', (q) =>
          q.eq('harnessSessionId', session._id).gt('turnSeq', cursor)
        )
        .order('asc')
        .collect();

      const pending = pendingTurns.filter((t) => t.role === 'user');

      if (pending.length > 0) {
        const s = requireOpencodeSession(session);
        sessions.push({
          _id: session._id as string,
          workspaceId: session.workspaceId as string,
          harnessName: s.opencode.harnessName,
          opencodeSessionId: s.opencode.opencodeSessionId,
          lastUsedConfig: s.opencode.lastUsedConfig,
        });
        for (const turn of pending) {
          allMessages.push({
            harnessSessionId: turn.harnessSessionId as unknown as string,
            content: turn.textContent,
            seq: turn.turnSeq,
          });
        }
      }
    }

    return { sessions, messages: allMessages };
  },
});
