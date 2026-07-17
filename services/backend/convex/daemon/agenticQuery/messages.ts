// fallow-ignore-file code-duplication
import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from '../../_generated/server';
import {
  getRunWithAccess,
  requireDirectHarnessWorkers,
  requireOpencodeRun,
} from '../../api/agenticQueryHelpers';
import { requireMachineWorkspaces } from '../directHarness/machineWorkspaces';

export const appendMessages = mutation({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_agenticQueryRuns'),
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
    await getRunWithAccess(ctx, args.sessionId, args.runId);

    if (args.chunks.length === 0) return { inserted: 0 };

    for (const chunk of args.chunks) {
      await ctx.db.insert('chatroom_agenticQueryRunMessages', {
        runId: args.runId,
        role: 'assistant',
        content: chunk.content,
        timestamp: chunk.timestamp,
        messageId: chunk.messageId,
        partType: chunk.partType,
      });
    }

    await ctx.db.patch('chatroom_agenticQueryRuns', args.runId, {
      lastActiveAt: Date.now(),
    });

    return { inserted: args.chunks.length };
  },
});

export const pendingForMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const workspaces = await requireMachineWorkspaces(ctx, args.sessionId, args.machineId);
    if (workspaces.length === 0) return { sessions: [], messages: [] };

    const workspaceIds = new Set(workspaces.map((w) => w._id));

    const allRuns = (
      await Promise.all(
        [...workspaceIds].flatMap((wsId) => [
          ctx.db
            .query('chatroom_agenticQueryRuns')
            .withIndex('by_workspace_status', (q) =>
              q.eq('workspaceId', wsId).eq('status', 'pending')
            )
            .collect(),
          ctx.db
            .query('chatroom_agenticQueryRuns')
            .withIndex('by_workspace_status', (q) =>
              q.eq('workspaceId', wsId).eq('status', 'active')
            )
            .collect(),
          ctx.db
            .query('chatroom_agenticQueryRuns')
            .withIndex('by_workspace_status', (q) => q.eq('workspaceId', wsId).eq('status', 'idle'))
            .collect(),
        ])
      )
    ).flat();

    const sessions: {
      kind: 'agentic-query';
      runId: string;
      workspaceId: string;
      harnessName: string;
      opencodeSessionId: string | undefined;
      agenticQueryId: string;
      chatroomId: string;
      lastUsedConfig: { agent: string; model?: { providerID: string; modelID: string } };
    }[] = [];
    const allMessages: { runId: string; content: string; seq: number }[] = [];

    for (const run of allRuns) {
      const cursor = run.lastProcessedTurnSeq ?? 0;
      const pendingTurns = await ctx.db
        .query('chatroom_agenticQueryRunTurns')
        .withIndex('by_run_turnSeq', (q) => q.eq('runId', run._id).gt('turnSeq', cursor))
        .order('asc')
        .collect();

      const pending = pendingTurns.filter((t) => t.role === 'user');

      if (pending.length > 0) {
        const s = requireOpencodeRun(run);
        const workspace = workspaces.find((w) => w._id === run.workspaceId);
        const chatroomId = workspace?.chatroomId as string | undefined;
        if (!chatroomId) continue;

        sessions.push({
          kind: 'agentic-query',
          runId: run._id as string,
          workspaceId: run.workspaceId as string,
          harnessName: s.opencode.harnessName,
          opencodeSessionId: s.opencode.opencodeSessionId,
          agenticQueryId: run.agenticQueryId as string,
          chatroomId,
          lastUsedConfig: s.opencode.lastUsedConfig,
        });
        for (const turn of pending) {
          allMessages.push({
            runId: turn.runId as unknown as string,
            content: turn.textContent,
            seq: turn.turnSeq,
          });
        }
      }
    }

    return { sessions, messages: allMessages };
  },
});
