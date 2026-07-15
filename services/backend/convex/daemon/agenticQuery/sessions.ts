import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { requireMachineWorkspaces } from '../directHarness/machineWorkspaces';
import { query } from '../../_generated/server';
import { requireDirectHarnessWorkers } from '../../api/directHarnessHelpers';

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

    return allSessions
      .filter((s) => (s as Record<string, unknown>).purpose === 'agentic-query')
      .map((s) => s._id);
  },
});
