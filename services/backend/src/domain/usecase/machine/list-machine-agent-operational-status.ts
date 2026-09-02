import type { MachineAgentOperationalRowView } from './list-operational-status-for-machine-signal-range';
import type { QueryCtx } from '../../../../convex/_generated/server';

export type ListMachineAgentOperationalStatusInput = {
  machineId: string;
  userId: string;
};

export async function listMachineAgentOperationalStatus(
  ctx: QueryCtx,
  input: ListMachineAgentOperationalStatusInput
): Promise<MachineAgentOperationalRowView[]> {
  void input.userId;
  const rows = await ctx.db
    .query('chatroom_agentRoleOperationalStatus')
    .withIndex('by_machineId', (q) => q.eq('machineId', input.machineId))
    .collect();
  return rows.map((row) => ({
    chatroomId: row.chatroomId,
    role: row.role,
    operationalState: row.operationalState,
    isAlive: row.isAlive,
    isRunning: row.isRunning,
    daemonConnected: row.daemonConnected,
    revisionKey: row.revisionKey,
    ...(row.stopState ? { stopState: row.stopState } : {}),
  }));
}
