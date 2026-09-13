import { getAgentRuntimeState } from './agent-runtime-state';
import { requestWorkspaceAgentStop } from './request-chatroom-workspace-agent-stop';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function deleteStaleTeamAgentConfigs(
  ctx: MutationCtx,
  teamRoleKey: string
): Promise<void> {
  const stale = await ctx.db
    .query('chatroom_agentDesiredConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .collect();
  const grouped = new Map<Id<'chatroom_rooms'>, { machineId: string; role: string }[]>();
  for (const row of stale) {
    const runtime = await getAgentRuntimeState(ctx, row._id);
    if (row.type === 'remote' && runtime?.pid != null && row.machineId)
      grouped.set(row.chatroomId, [
        ...(grouped.get(row.chatroomId) ?? []),
        { machineId: row.machineId, role: row.role },
      ]);
  }
  for (const [chatroomId, configs] of grouped)
    for (const config of configs) await requestWorkspaceAgentStop(ctx, { chatroomId, ...config });
  for (const row of stale) {
    const runtime = await getAgentRuntimeState(ctx, row._id);
    if (runtime) await ctx.db.delete('chatroom_agentRuntimeStates', runtime._id);
    await ctx.db.delete('chatroom_agentDesiredConfigs', row._id);
  }
}
