// fallow-ignore-file code-duplication complexity
import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

export type ListOperationalStatusForMachineSignalRangeInput = {
  machineId: string;
  chatroomId: string;
  userId: string;
  afterSignalKey: string;
  throughSignalKey: string;
  limit: number;
};

export type MachineAgentOperationalRowView = {
  chatroomId: string;
  role: string;
  operationalState: 'running' | 'stopped' | 'starting' | 'circuit_open';
  isAlive: boolean;
  isRunning: boolean;
  daemonConnected: boolean;
  revisionKey: string;
};

export type ListOperationalStatusForMachineSignalRangeResult = {
  rows: MachineAgentOperationalRowView[];
  nextSignalKey: string | null;
  hasMore: boolean;
};

export async function listOperationalStatusForMachineSignalRange(
  ctx: QueryCtx,
  input: ListOperationalStatusForMachineSignalRangeInput
): Promise<ListOperationalStatusForMachineSignalRangeResult> {
  void input.userId;
  const signals = await ctx.db
    .query('chatroom_machineAgentOperationalSignals')
    .withIndex('by_machineId_chatroomId_signalKey', (q) =>
      q
        .eq('machineId', input.machineId)
        .eq('chatroomId', input.chatroomId as Id<'chatroom_rooms'>)
        .gt('signalKey', input.afterSignalKey)
        .lte('signalKey', input.throughSignalKey)
    )
    .order('asc')
    .take(input.limit + 1);
  const page = signals.slice(0, input.limit);
  const rows: MachineAgentOperationalRowView[] = [];
  for (const signal of page) {
    const row = await ctx.db
      .query('chatroom_agentRoleOperationalStatus')
      .withIndex('by_chatroom_role', (q) =>
        q.eq('chatroomId', signal.chatroomId).eq('role', signal.role)
      )
      .first();
    if (!row) continue;
    rows.push({
      chatroomId: row.chatroomId,
      role: row.role,
      operationalState: row.operationalState,
      isAlive: row.isAlive,
      isRunning: row.isRunning,
      daemonConnected: row.daemonConnected,
      revisionKey: row.revisionKey,
    });
  }

  return {
    rows,
    nextSignalKey: page.at(-1)?.signalKey ?? null,
    hasMore: signals.length > input.limit,
  };
}
