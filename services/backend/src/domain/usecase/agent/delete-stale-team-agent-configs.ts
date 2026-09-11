import { requestWorkspaceAgentStop } from './request-chatroom-workspace-agent-stop';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function deleteStaleTeamAgentConfigs(
  ctx: MutationCtx,
  teamRoleKey: string
): Promise<void> {
  const stale = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .collect();
  const grouped = new Map<Id<'chatroom_rooms'>, { machineId: string; role: string }[]>();
  for (const row of stale)
    if (row.type === 'remote' && row.spawnedAgentPid != null && row.machineId)
      grouped.set(row.chatroomId, [
        ...(grouped.get(row.chatroomId) ?? []),
        { machineId: row.machineId, role: row.role },
      ]);
  for (const [chatroomId, configs] of grouped)
    for (const config of configs) await requestWorkspaceAgentStop(ctx, { chatroomId, ...config });
  for (const row of stale) await ctx.db.delete('chatroom_teamAgentConfigs', row._id);
}
