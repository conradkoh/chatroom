import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import type { AgentType } from '../../entities/agent';
import { getTeamStructure } from '../../entities/team-presets';
import { hasActiveEnhancerWork } from '../enhancer/enhancer-entry-point-status';
import { getActiveTeamStructure } from '../team/active-team-structure';

type OperationalState = 'starting' | 'running' | 'stopped' | 'circuit_open';

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

function toViewState(status: string | undefined): OperationalState {
  switch (status) {
    case 'starting':
      return 'starting';
    case 'waiting':
    case 'working':
      return 'running';
    case 'error':
      return 'circuit_open';
    default:
      return 'stopped';
  }
}

/**
 * Compatibility-shaped agent overview backed by the active static team
 * structure and the daemon-fed role status model. It intentionally does not
 * require a launch request, desired-config row, or runtime row for a role to
 * appear.
 */
export async function getAgentViewStatus(
  ctx: QueryCtx,
  input: { chatroomId: Id<'chatroom_rooms'>; userId: Id<'users'> }
): Promise<AgentViewStatus | null> {
  const chatroom = await ctx.db.get('chatroom_rooms', input.chatroomId);
  if (!chatroom || chatroom.ownerId !== input.userId) return null;

  const active = await getActiveTeamStructure(ctx, input.chatroomId);
  const structure = active ? getTeamStructure({ teamId: active.teamStructureId }) : null;
  if (!structure) return null;

  const rows = await ctx.db
    .query('chatroom_agentRoleStatusReadModel')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId))
    .collect();
  const rowByRole = new Map(rows.map((row) => [row.role.toLowerCase(), row]));
  const machineIds = [...new Set(rows.flatMap((row) => (row.machineId ? [row.machineId] : [])))];
  const machines = await Promise.all(
    machineIds.map(async (machineId) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return [machineId, machine?.alias ?? machine?.hostname] as const;
    })
  );
  const machineNames = new Map(machines.filter(([, name]) => name !== undefined));
  const hasHistory =
    (await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId))
      .first()) !== null;

  const agents = structure.roles.map(({ role }): AgentViewRole => {
    const row = rowByRole.get(role.toLowerCase());
    return {
      role,
      state: toViewState(row?.status),
      type: (row?.agentType ?? 'remote') as AgentType,
      machineId: row?.machineId,
      machineName: row?.machineId ? machineNames.get(row.machineId) : undefined,
      lastSeenAt: row?.lastSeenAt ?? null,
      lastSeenAction: row?.lastSeenAction ?? null,
    };
  });

  return {
    teamId: structure.teamId,
    teamName: structure.teamName,
    teamRoles: structure.roles.map(({ role }) => role),
    agents,
    hasHistory,
    hasActiveEnhancerWork: await hasActiveEnhancerWork(ctx, input.chatroomId),
  };
}
