import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import {
  getNextTurnSeq,
  getSessionWithAccess,
  requireDirectHarnessWorkers,
} from '../../api/directHarnessHelpers.js';
import { getAuthenticatedUser } from '../../auth/authenticatedUser.js';
import { mutation } from '../../_generated/server.js';
import type { MutationCtx } from '../../_generated/server.js';
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
