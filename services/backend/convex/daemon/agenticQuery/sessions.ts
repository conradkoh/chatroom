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
    if (workspaces.length === 0) return [];

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
              q.eq('workspaceId', wsId).eq('status', 'spawning')
            )
            .collect(),
        ])
      )
    ).flat();

    const shaped: {
      kind: 'agentic-query';
      _id: string;
      workspaceId: string;
      harnessName: string;
      agenticQueryId: string;
      chatroomId: string;
      lastUsedConfig: { agent: string; model?: { providerID: string; modelID: string } };
    }[] = [];

    for (const session of allSessions) {
      if (!isAgenticQueryHarnessSession(session)) continue;
      const agenticQueryId = session.agenticQueryId;
      const workspace = workspaces.find((w) => w._id === session.workspaceId);
      const chatroomId = workspace?.chatroomId as string | undefined;
      if (!chatroomId) continue;

      const s = requireOpencodeSession(session);

      shaped.push({
        kind: 'agentic-query',
        _id: session._id as string,
        workspaceId: session.workspaceId as string,
        harnessName: s.opencode.harnessName,
        agenticQueryId,
        chatroomId,
        lastUsedConfig: s.opencode.lastUsedConfig,
      });
    }

    return shaped;
  },
});
