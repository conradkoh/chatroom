import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { requireMachineWorkspaces } from '../directHarness/machineWorkspaces';
import { query } from '../../_generated/server';
import {
  requireDirectHarnessWorkers,
  requireOpencodeSession,
} from '../../api/directHarnessHelpers';
import { isAgenticQueryHarnessSession } from './isAgenticQueryHarnessSession';

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
      kind: 'agentic-query';
      _id: string;
      workspaceId: string;
      harnessName: string;
      opencodeSessionId: string | undefined;
      agenticQueryId: string;
      chatroomId: string;
      lastUsedConfig: { agent: string; model?: { providerID: string; modelID: string } };
    }[] = [];
    const allMessages: { harnessSessionId: string; content: string; seq: number }[] = [];

    for (const session of allSessions) {
      if (!isAgenticQueryHarnessSession(session)) continue;
      const agenticQueryId = session.agenticQueryId;

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
        const workspace = workspaces.find((w) => w._id === session.workspaceId);
        const chatroomId = workspace?.chatroomId as string | undefined;
        if (!chatroomId) continue;

        sessions.push({
          kind: 'agentic-query',
          _id: session._id as string,
          workspaceId: session.workspaceId as string,
          harnessName: s.opencode.harnessName,
          opencodeSessionId: s.opencode.opencodeSessionId,
          agenticQueryId,
          chatroomId,
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
