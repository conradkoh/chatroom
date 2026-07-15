import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { trySyncAgenticQueryFromHarnessTurn } from '../agenticQuery/syncFromHarnessTurn';
import { requireMachineWorkspaces } from './machineWorkspaces';
import type { Id } from '../../_generated/dataModel';
import { mutation, query } from '../../_generated/server';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import {
  getNextTurnSeq,
  getSessionWithAccess,
  requireDirectHarnessWorkers,
  requireHarnessSessionOnOwnedMachine,
} from '../../api/directHarnessHelpers';
import { requireMachineOwner } from '../../auth/cli/machineAccess';

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

    const harnessSession = await ctx.db.get('chatroom_harnessSessions', args.harnessSessionId);
    if (!harnessSession) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `HarnessSession ${args.harnessSessionId} not found`,
      });
    }

    const workspace = await ctx.db.get('chatroom_workspaces', harnessSession.workspaceId);
    if (!workspace) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Workspace ${harnessSession.workspaceId} not found`,
      });
    }

    await requireMachineOwner(ctx, args.sessionId, workspace.machineId);

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

      // Chunks are returned in _creationTime (insertion) order by the by_messageId index.

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

    await trySyncAgenticQueryFromHarnessTurn(ctx, {
      harnessSessionId: turn.harnessSessionId,
      assistantText: textContent,
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
  // Chunks are returned in _creationTime (insertion) order by the by_messageId index.

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

    await requireHarnessSessionOnOwnedMachine(
      ctx,
      args.sessionId,
      args.machineId,
      args.harnessSessionId
    );

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
    const workspaces = await requireMachineWorkspaces(ctx, args.sessionId, args.machineId);
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
