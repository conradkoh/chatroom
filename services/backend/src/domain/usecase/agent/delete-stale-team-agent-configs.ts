import type { MutationCtx } from '../../../../convex/_generated/server';
import { createAgentStopCommand } from './create-agent-stop-command';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { AgentStopSelectedConfig } from './select-agent-stop-configs';

export async function deleteStaleTeamAgentConfigs(ctx: MutationCtx, teamRoleKey: string): Promise<void> {
  const stale = await ctx.db.query('chatroom_teamAgentConfigs').withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey)).collect();
  const grouped = new Map<Id<'chatroom_rooms'>, AgentStopSelectedConfig[]>();
  for (const row of stale) if (row.type === 'remote' && row.spawnedAgentPid != null && row.machineId && row.agentHarness) grouped.set(row.chatroomId, [...(grouped.get(row.chatroomId) ?? []), row as AgentStopSelectedConfig]);
  for (const [chatroomId, selectedConfigs] of grouped) await createAgentStopCommand(ctx, { chatroomId, scope: { kind: 'chatroom' }, reason: 'platform.dedup', selectedConfigs });
  for (const row of stale) await ctx.db.delete('chatroom_teamAgentConfigs', row._id);
}
