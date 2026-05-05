/**
 * Daemon-facing harness session message endpoints.
 *
 * Called from the CLI daemon to write response chunks and query unprocessed
 * user messages. Uses role='assistant' for response chunks and filters by
 * session.lastProcessedSeq for cursor-based polling.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getAuthenticatedUser } from '../../../auth/authenticatedUser.js';
import { getSessionWithAccess, requireDirectHarnessWorkers } from '../helpers.js';
import { mutation, query } from '../../../_generated/server.js';

// ─── appendMessages ──────────────────────────────────────────────────────────

/**
 * Append output chunks from a harness session to its message stream.
 *
 * All chunks are written with role='assistant' to distinguish them from
 * user messages. Idempotent on (harnessSessionRowId, seq) — duplicate
 * chunks are silently skipped.
 *
 * Returns { inserted, skipped } counts.
 */
export const appendMessages = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
    chunks: v.array(
      v.object({
        seq: v.number(),
        content: v.string(),
        timestamp: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionRowId);

    let inserted = 0;
    let skipped = 0;

    for (const chunk of args.chunks) {
      const existing = await ctx.db
        .query('chatroom_harnessSessionMessages')
        .withIndex('by_session_seq', (q) =>
          q.eq('harnessSessionRowId', args.harnessSessionRowId).eq('seq', chunk.seq)
        )
        .unique();

      if (existing) {
        skipped++;
        continue;
      }

      await ctx.db.insert('chatroom_harnessSessionMessages', {
        harnessSessionRowId: args.harnessSessionRowId,
        seq: chunk.seq,
        role: 'assistant',
        content: chunk.content,
        timestamp: chunk.timestamp,
      });
      inserted++;
    }

    if (inserted > 0) {
      await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionRowId, {
        lastActiveAt: Date.now(),
      });
    }

    return { inserted, skipped };
  },
});

// ─── pendingForMachine ──────────────────────────────────────────────────────────

/**
 * Return all unprocessed user messages across all sessions for this machine.
 *
 * For each session owned by this machine, returns user messages where
 * seq > session.lastProcessedSeq. Also returns the session info (id,
 * workspaceId, lastProcessedSeq, lastUsedConfig) so the daemon can
 * process messages and update the cursor.
 *
 * Auth: machine ownership (same pattern as publishMachineCapabilities).
 */
export const pendingForMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) return { sessions: [], messages: [] };

    // Find all workspaces for this machine
    const workspaces = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_machine', (q) => q.eq('machineId', args.machineId))
      .collect();

    if (workspaces.length === 0) return { sessions: [], messages: [] };

    const workspaceIds = new Set(workspaces.map((w) => w._id));

    // Find all sessions for these workspaces
    const allSessions = (
      await Promise.all(
        [...workspaceIds].map((workspaceId) =>
          ctx.db
            .query('chatroom_harnessSessions')
            .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
            .collect()
        )
      )
    ).flat();

    // For each session, check for unprocessed user messages
    const sessions: Array<{
      _id: string;
      workspaceId: string;
      lastProcessedSeq: number;
      lastUsedConfig: { agent: string; model?: { providerID: string; modelID: string } };
    }> = [];

    const allMessages: Array<{
      harnessSessionRowId: string;
      content: string;
      seq: number;
    }> = [];

    for (const session of allSessions) {
      const cursor = session.lastProcessedSeq ?? 0;

      const pendingMessages = await ctx.db
        .query('chatroom_harnessSessionMessages')
        .withIndex('by_session_role_seq', (q) =>
          q
            .eq('harnessSessionRowId', session._id)
            .eq('role', 'user')
            .gt('seq', cursor)
        )
        .order('asc')
        .collect();

      if (pendingMessages.length > 0) {
        sessions.push({
          _id: session._id as string,
          workspaceId: session.workspaceId as string,
          lastProcessedSeq: cursor,
          lastUsedConfig: session.lastUsedConfig,
        });

        for (const msg of pendingMessages) {
          allMessages.push({
            harnessSessionRowId: msg.harnessSessionRowId as string,
            content: msg.content,
            seq: msg.seq,
          });
        }
      }
    }

    return { sessions, messages: allMessages };
  },
});
