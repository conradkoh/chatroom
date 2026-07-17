// fallow-ignore-file code-duplication complexity
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from '../../_generated/server';
import {
  getRunWithAccess,
  requireDirectHarnessWorkers,
  requireOpencodeRun,
} from '../../api/agenticQueryHelpers';
import { withMachineWorkspaces } from '../directHarness/machineWorkspaces';

export const associateOpenCodeSessionId = mutation({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_agenticQueryRuns'),
    opencodeSessionId: v.string(),
    sessionTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { run } = await getRunWithAccess(ctx, args.sessionId, args.runId);
    const s = requireOpencodeRun(run);

    const existing = s.opencode.opencodeSessionId;
    if (existing === args.opencodeSessionId) return;
    if (existing !== undefined && existing !== null) {
      throw new ConvexError({
        code: 'HARNESS_SESSION_ALREADY_ASSOCIATED',
        message: `Run ${args.runId} already has opencodeSessionId '${existing}'.`,
      });
    }

    await ctx.db.patch('chatroom_agenticQueryRuns', args.runId, {
      status: 'active',
      opencode: {
        ...s.opencode,
        opencodeSessionId: args.opencodeSessionId,
        ...(args.sessionTitle ? { sessionTitle: args.sessionTitle } : {}),
      },
    });
  },
});

export const closeRun = mutation({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_agenticQueryRuns'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { run } = await getRunWithAccess(ctx, args.sessionId, args.runId);
    if (run.status === 'closed') return;
    await ctx.db.patch('chatroom_agenticQueryRuns', args.runId, {
      status: 'closed',
      lastActiveAt: Date.now(),
    });
  },
});

export const markIdle = mutation({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_agenticQueryRuns'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { run } = await getRunWithAccess(ctx, args.sessionId, args.runId);
    if (run.status === 'failed' || run.status === 'closed') return;
    await ctx.db.patch('chatroom_agenticQueryRuns', args.runId, {
      status: 'idle',
      isGenerating: false,
      lastActiveAt: Date.now(),
    });
  },
});

export const markFailed = mutation({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_agenticQueryRuns'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getRunWithAccess(ctx, args.sessionId, args.runId);
    await ctx.db.patch('chatroom_agenticQueryRuns', args.runId, {
      status: 'failed',
      isGenerating: false,
      lastActiveAt: Date.now(),
    });
  },
});

export const markActive = mutation({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_agenticQueryRuns'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { run } = await getRunWithAccess(ctx, args.sessionId, args.runId);
    if (run.status === 'failed' || run.status === 'closed') return;
    await ctx.db.patch('chatroom_agenticQueryRuns', args.runId, {
      status: 'active',
      lastActiveAt: Date.now(),
    });
  },
});

export const getRun = query({
  args: {
    runId: v.id('chatroom_agenticQueryRuns'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const run = await ctx.db.get('chatroom_agenticQueryRuns', args.runId);
    if (!run) return null;
    const s = requireOpencodeRun(run);
    return {
      _id: s._id,
      type: s.type,
      status: s.status,
      isGenerating: s.isGenerating ?? false,
      harnessName: s.opencode.harnessName,
      opencodeSessionId: s.opencode.opencodeSessionId,
      lastUsedConfig: s.opencode.lastUsedConfig,
      workspaceId: s.workspaceId,
      agenticQueryId: s.agenticQueryId,
    };
  },
});

export const pendingForMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) =>
    withMachineWorkspaces(ctx, args.sessionId, args.machineId, [], async (workspaces) => {
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
                q.eq('workspaceId', wsId).eq('status', 'spawning')
              )
              .collect(),
          ])
        )
      ).flat();

      const shaped: {
        kind: 'agentic-query';
        runId: string;
        workspaceId: string;
        harnessName: string;
        agenticQueryId: string;
        chatroomId: string;
        lastUsedConfig: { agent: string; model?: { providerID: string; modelID: string } };
      }[] = [];

      for (const run of allRuns) {
        const workspace = workspaces.find((w) => w._id === run.workspaceId);
        const chatroomId = workspace?.chatroomId as string | undefined;
        if (!chatroomId) continue;

        const s = requireOpencodeRun(run);

        shaped.push({
          kind: 'agentic-query',
          runId: run._id as string,
          workspaceId: run.workspaceId as string,
          harnessName: s.opencode.harnessName,
          agenticQueryId: run.agenticQueryId as string,
          chatroomId,
          lastUsedConfig: s.opencode.lastUsedConfig,
        });
      }

      return shaped;
    }),
});
