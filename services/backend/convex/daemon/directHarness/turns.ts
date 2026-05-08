import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import {
  getSessionWithAccess,
  requireDirectHarnessWorkers,
} from '../../api/directHarnessHelpers.js';
import { mutation } from '../../_generated/server.js';

// ─── beginAssistantTurn ──────────────────────────────────────────────────────

export const beginAssistantTurn = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    // Allocate next turnSeq = max existing + 1 (1-based)
    const lastTurn = await ctx.db
      .query('chatroom_harnessSessionTurns')
      .withIndex('by_session_turnSeq', (q) => q.eq('harnessSessionId', args.harnessSessionId))
      .order('desc')
      .first();
    const turnSeq = (lastTurn?.turnSeq ?? 0) + 1;

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
