import type { MutationCtx } from '../../../../convex/_generated/server';
import { createAgentStopCommand } from './create-agent-stop-command';

export async function deleteStaleTeamAgentConfigs(ctx: MutationCtx, teamRoleKey: string): Promise<void> {
  const stale = await ctx.db.query('chatroom_teamAgentConfigs').withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey)).collect();
  for (const row of stale) {
    if (row.spawnedAgentPid != null && row.machineId) {
      await createAgentStopCommand(ctx, { chatroomId: row.chatroomId, scope: { kind: 'agent', role: row.role }, reason: 'platform.dedup', machineId: row.machineId });
    }
    await ctx.db.delete('chatroom_teamAgentConfigs', row._id);
  }
}
