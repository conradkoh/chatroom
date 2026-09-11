import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import type { AgentType } from '../../entities/agent';
import type { OperationalState } from '../agent/derive-agent-operational-state';
import { hasActiveEnhancerWork } from '../enhancer/enhancer-entry-point-status';

export interface AgentViewRole {
  role: string;
  state: OperationalState;
  type: AgentType;
  machineId?: string | undefined;
  machineName?: string | undefined;
  lastSeenAt: number | null;
  lastSeenAction: string | null;
}
export interface AgentViewStatus {
  teamId: string;
  teamName: string;
  teamRoles: string[];
  agents: AgentViewRole[];
  hasHistory: boolean;
  hasActiveEnhancerWork: boolean;
}

async function getMachineHostname(ctx: QueryCtx, machineId: string): Promise<string | undefined> {
  const identity = await ctx.db
    .query('chatroom_machineIdentity')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  return identity?.hostname;
}

/** Returns the complete UI projection without reading domain state tables. */
export async function getAgentViewStatus(
  ctx: QueryCtx,
  input: { chatroomId: Id<'chatroom_rooms'>; userId: Id<'users'> }
): Promise<AgentViewStatus | null> {
  const metadata = await ctx.db
    .query('chatroom_agentViewMetadata')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId))
    .first();
  if (!metadata || metadata.ownerId !== input.userId || !metadata.teamId) return null;

  const rows = await ctx.db
    .query('chatroom_agentRoleStatusReadModel')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId))
    .collect();
  const rowByRole = new Map(rows.map((row) => [row.role.toLowerCase(), row]));
  const machineNames = new Map<string, string>();
  for (const machineId of [
    ...new Set(rows.flatMap((row) => (row.machineId ? [row.machineId] : []))),
  ]) {
    const hostname = await getMachineHostname(ctx, machineId);
    if (hostname) machineNames.set(machineId, hostname);
  }

  const agents = metadata.teamRoles.map((role): AgentViewRole => {
    const row = rowByRole.get(role.toLowerCase());
    const projectedState = row?.viewState === 'idle' ? undefined : row?.viewState;
    return {
      role,
      state: projectedState ?? 'stopped',
      type: (row?.agentType ?? 'remote') as AgentType,
      machineId: row?.machineId,
      machineName: row?.machineId ? machineNames.get(row.machineId) : undefined,
      lastSeenAt: row?.lastSeenAt ?? null,
      lastSeenAction: row?.lastSeenAction ?? null,
    };
  });

  return {
    teamId: metadata.teamId,
    teamName: metadata.teamName,
    teamRoles: metadata.teamRoles,
    agents,
    hasHistory: metadata.hasHistory,
    hasActiveEnhancerWork: await hasActiveEnhancerWork(ctx, input.chatroomId),
  };
}
