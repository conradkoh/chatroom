import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { withMachineWorkspaces } from './machineWorkspaces';
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
import { aggregateAssistantChunks } from '../../api/harnessChunkAggregate';

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

    const { textContent, reasoningContent } = await aggregateChunksForTurn(ctx, turn);

    await ctx.db.patch('chatroom_harnessSessionTurns', args.turnId, {
      status: 'complete',
      textContent,
      reasoningContent,
      completedAt: Date.now(),
    });

    return { ok: true };
  },
});

// ─── aggregateChunksForTurn (shared helper) ──────────────────────────────────

/**
 * Aggregates assistant chunks that belong to a turn.
 *
 * OpenCode (and some other harnesses) may emit multiple SDK messageIds per logical
 * turn — e.g. reasoning-only messages followed by a final text message. We join
 * chunks to a turn by timestamp window: [turn.startedAt, nextTurn.startedAt).
 */
export async function aggregateChunksForTurn(
  ctx: { db: MutationCtx['db'] | QueryCtx['db'] },
  turn: {
    harnessSessionId: Id<'chatroom_harnessSessions'>;
    turnSeq: number;
    startedAt: number;
  }
): Promise<{ textContent: string; reasoningContent: string }> {
  const nextTurn = await ctx.db
    .query('chatroom_harnessSessionTurns')
    .withIndex('by_session_turnSeq', (q) =>
      q.eq('harnessSessionId', turn.harnessSessionId).gt('turnSeq', turn.turnSeq)
    )
    .order('asc')
    .first();

  const upperBound = nextTurn?.startedAt ?? Number.MAX_SAFE_INTEGER;

  const chunks = await ctx.db
    .query('chatroom_harnessSessionMessages')
    .withIndex('by_session_role', (q) =>
      q.eq('harnessSessionId', turn.harnessSessionId).eq('role', 'assistant')
    )
    .collect();

  return aggregateAssistantChunks(chunks, turn.startedAt, upperBound);
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

      const aggregated = await aggregateChunksForTurn(ctx, turn);
      textContent = aggregated.textContent;
      reasoningContent = aggregated.reasoningContent;

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
  handler: async (ctx, args) =>
    withMachineWorkspaces(ctx, args.sessionId, args.machineId, [], async (workspaces) => {
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
    }),
});
