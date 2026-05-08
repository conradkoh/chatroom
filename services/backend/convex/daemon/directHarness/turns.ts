import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import {
  getNextTurnSeq,
  getSessionWithAccess,
  requireDirectHarnessWorkers,
} from '../../api/directHarnessHelpers.js';
import { getAuthenticatedUser } from '../../auth/authenticatedUser.js';
import { mutation, query } from '../../_generated/server.js';
import type { MutationCtx, QueryCtx } from '../../_generated/server.js';
import type { Id } from '../../_generated/dataModel.js';

// ─── insertUserTurn (internal helper) ───────────────────────────────────────

/**
 * Inserts a user turn row into chatroom_harnessSessionTurns.
 * Used by the three user-message write sites (web/sessions.create,
 * web/messages.send, daemon/queue.dequeueNext).
 */
export async function insertUserTurn(
  ctx: { db: MutationCtx['db'] },
  harnessSessionId: Id<'chatroom_harnessSessions'>,
  content: string,
  timestamp: number
): Promise<{ turnId: Id<'chatroom_harnessSessionTurns'>; turnSeq: number }> {
  const turnSeq = await getNextTurnSeq(ctx, harnessSessionId);
  const turnId = await ctx.db.insert('chatroom_harnessSessionTurns', {
    harnessSessionId,
    turnSeq,
    role: 'user',
    status: 'complete',
    textContent: content.trim(),
    reasoningContent: '',
    startedAt: timestamp,
    completedAt: timestamp,
  });
  await ctx.db.patch('chatroom_harnessSessions', harnessSessionId, { lastActiveAt: timestamp });
  return { turnId, turnSeq };
}

// ─── beginAssistantTurn ──────────────────────────────────────────────────────

export const beginAssistantTurn = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    const turnSeq = await getNextTurnSeq(ctx, args.harnessSessionId);

    const turnId = await ctx.db.insert('chatroom_harnessSessionTurns', {
      harnessSessionId: args.harnessSessionId,
      turnSeq,
      role: 'assistant',
      status: 'pending',
      textContent: '',
      reasoningContent: '',
      startedAt: Date.now(),
    });

    return { turnId, turnSeq };
  },
});

// ─── markTurnProcessed ───────────────────────────────────────────────────────

export const markTurnProcessed = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    turnSeq: v.number(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) throw new Error('Authentication required');

    const harnessSession = await ctx.db.get('chatroom_harnessSessions', args.harnessSessionId);
    if (!harnessSession) throw new Error('Session not found');

    const workspace = await ctx.db.get('chatroom_workspaces', harnessSession.workspaceId);
    if (!workspace) throw new Error('Workspace not found');

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', workspace.machineId))
      .first();
    if (!machine || machine.userId !== auth.user._id) throw new Error('Unauthorized');

    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
      lastProcessedTurnSeq: args.turnSeq,
    });
  },
});

// ─── bindTurnMessageId ───────────────────────────────────────────────────────

export const bindTurnMessageId = mutation({
  args: {
    ...SessionIdArg,
    turnId: v.id('chatroom_harnessSessionTurns'),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const turn = await ctx.db.get('chatroom_harnessSessionTurns', args.turnId);
    if (!turn) return; // defensive

    // Verify session access
    await getSessionWithAccess(ctx, args.sessionId, turn.harnessSessionId);

    // Idempotent: if already streaming or complete, return silently
    if (turn.status !== 'pending') return;
    if (turn.role !== 'assistant') return;

    await ctx.db.patch('chatroom_harnessSessionTurns', args.turnId, {
      status: 'streaming',
      messageId: args.messageId,
    });
  },
});

// ─── finalizeAssistantTurn ───────────────────────────────────────────────────

export const finalizeAssistantTurn = mutation({
  args: {
    ...SessionIdArg,
    turnId: v.id('chatroom_harnessSessionTurns'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const turn = await ctx.db.get('chatroom_harnessSessionTurns', args.turnId);
    if (!turn) return; // defensive

    // Idempotent: already finalized
    if (turn.status === 'complete') return;

    // Verify session access
    await getSessionWithAccess(ctx, args.sessionId, turn.harnessSessionId);

    let textContent = '';
    let reasoningContent = '';

    if (turn.messageId) {
      // Aggregate chunks from the chunk table for this messageId using the index
      const chunks = await ctx.db
        .query('chatroom_harnessSessionMessages')
        .withIndex('by_messageId', (q) => q.eq('messageId', turn.messageId))
        .collect();
      // Sort by seq ascending for correct concatenation order
      chunks.sort((a, b) => a.seq - b.seq);

      for (const chunk of chunks) {
        const partType = chunk.partType ?? 'text';
        if (partType === 'text') {
          textContent += chunk.content;
        } else if (partType === 'reasoning') {
          reasoningContent += chunk.content;
        }
      }
    }
    // If no messageId (pending → idle with no chunks), finalize with empty content

    await ctx.db.patch('chatroom_harnessSessionTurns', args.turnId, {
      status: 'complete',
      textContent,
      reasoningContent,
      completedAt: Date.now(),
    });

    return { ok: true };
  },
});

// ─── aggregateChunksByMessageId (shared helper) ──────────────────────────────

/**
 * Aggregates text and reasoning content from chunks for a given messageId.
 * Used by both finalizeAssistantTurn and markOrphanTurnsFailed.
 */
export async function aggregateChunksByMessageId(
  ctx: { db: MutationCtx['db'] | QueryCtx['db'] },
  messageId: string
): Promise<{ textContent: string; reasoningContent: string }> {
  const chunks = await ctx.db
    .query('chatroom_harnessSessionMessages')
    .withIndex('by_messageId', (q) => q.eq('messageId', messageId))
    .collect();
  chunks.sort((a, b) => a.seq - b.seq);

  let textContent = '';
  let reasoningContent = '';
  for (const chunk of chunks) {
    const partType = chunk.partType ?? 'text';
    if (partType === 'text') {
      textContent += chunk.content;
    } else if (partType === 'reasoning') {
      reasoningContent += chunk.content;
    }
  }
  return { textContent, reasoningContent };
}

// ─── markOrphanTurnsFailed ───────────────────────────────────────────────────

export const markOrphanTurnsFailed = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    harnessSessionId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    // Auth: verify session exists and belongs to a workspace owned by args.machineId
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) throw new Error('Authentication required');

    const harnessSession = await ctx.db.get('chatroom_harnessSessions', args.harnessSessionId);
    if (!harnessSession) throw new Error('Session not found');

    const workspace = await ctx.db.get('chatroom_workspaces', harnessSession.workspaceId);
    if (!workspace) throw new Error('Workspace not found');

    if (workspace.machineId !== args.machineId)
      throw new Error('Unauthorized: session belongs to a different machine');

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (!machine || machine.userId !== auth.user._id) throw new Error('Unauthorized');

    const now = Date.now();
    let failedCount = 0;

    // Find all streaming turns for this session
    const streamingTurns = await ctx.db
      .query('chatroom_harnessSessionTurns')
      .withIndex('by_session_status', (q) =>
        q.eq('harnessSessionId', args.harnessSessionId).eq('status', 'streaming')
      )
      .collect();

    for (const turn of streamingTurns) {
      let textContent = '';
      let reasoningContent = '';

      if (turn.messageId) {
        // Aggregate chunks for best-effort partial content
        const aggregated = await aggregateChunksByMessageId(ctx, turn.messageId);
        textContent = aggregated.textContent;
        reasoningContent = aggregated.reasoningContent;
      }

      await ctx.db.patch('chatroom_harnessSessionTurns', turn._id, {
        status: 'failed',
        textContent,
        reasoningContent,
        completedAt: now,
      });
      failedCount++;
    }

    // Find all pending turns for this session
    const pendingTurns = await ctx.db
      .query('chatroom_harnessSessionTurns')
      .withIndex('by_session_status', (q) =>
        q.eq('harnessSessionId', args.harnessSessionId).eq('status', 'pending')
      )
      .collect();

    for (const turn of pendingTurns) {
      await ctx.db.patch('chatroom_harnessSessionTurns', turn._id, {
        status: 'failed',
        completedAt: now,
      });
      failedCount++;
    }

    // Clear isGenerating on the session
    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
      isGenerating: false,
    });

    return { failedTurns: failedCount };
  },
});

// ─── getMachineHarnessSessions ───────────────────────────────────────────────

/**
 * Returns harness sessions whose workspace belongs to the given machine,
 * filtered to 'active' and 'idle' statuses (sessions that should have a daemon attached).
 */
export const getMachineHarnessSessions = query({
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

    const results: {
      harnessSessionId: Id<'chatroom_harnessSessions'>;
      chatroomId: Id<'chatroom_rooms'>;
      workspaceId: Id<'chatroom_workspaces'>;
      status: string;
    }[] = [];

    for (const workspace of workspaces) {
      // Fetch active sessions for this workspace
      const activeSessions = await ctx.db
        .query('chatroom_harnessSessions')
        .withIndex('by_workspace_status', (q) =>
          q.eq('workspaceId', workspace._id).eq('status', 'active')
        )
        .collect();
      // Fetch idle sessions for this workspace
      const idleSessions = await ctx.db
        .query('chatroom_harnessSessions')
        .withIndex('by_workspace_status', (q) =>
          q.eq('workspaceId', workspace._id).eq('status', 'idle')
        )
        .collect();

      for (const session of [...activeSessions, ...idleSessions]) {
        results.push({
          harnessSessionId: session._id,
          chatroomId: workspace.chatroomId,
          workspaceId: workspace._id,
          status: session.status,
        });
      }
    }

    return results;
  },
});
