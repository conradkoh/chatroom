import { getTeamRolesFromChatroom } from './get-team-roles';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import type { AgentType } from '../../entities/agent';
import {
  deriveAgentRoleViewState,
  type OperationalState,
} from '../agent/derive-agent-operational-state';
import { hasActiveEnhancerWork } from '../enhancer/enhancer-entry-point-status';

export interface AgentViewRole {
  role: string;
  state: OperationalState;
  type: AgentType;
  machineId?: string;
  machineName?: string;
  lastSeenAt: number | null;
  lastSeenAction: string | null;
  stopState?: 'idle' | 'pending' | 'stopping' | 'stopped' | 'failed';
  activeStopCommandId?: string;
}
export interface AgentViewStatus {
  teamId: string;
  teamName: string;
  teamRoles: string[];
  agents: AgentViewRole[];
  hasHistory: boolean;
  hasActiveEnhancerWork: boolean;
}

async function getAgentViewStatusLegacy(
  ctx: QueryCtx,
  input: { chatroomId: Id<'chatroom_rooms'>; userId: Id<'users'> }
): Promise<AgentViewStatus | null> {
  const chatroom = await ctx.db.get('chatroom_rooms', input.chatroomId);
  if (!chatroom || chatroom.ownerId !== input.userId || !chatroom.teamId || !chatroom.teamRoles)
    return null;
  const { teamRoles } = getTeamRolesFromChatroom(chatroom);
  const rows = await ctx.db
    .query('chatroom_agentRoleOperationalStatus')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId))
    .collect();
  const participants = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId))
    .collect();
  const rowByRole = new Map(rows.map((r) => [r.role.toLowerCase(), r]));
  const participantByRole = new Map(participants.map((p) => [p.role.toLowerCase(), p]));
  const machineIds = [...new Set(rows.flatMap((r) => (r.machineId ? [r.machineId] : [])))];
  const machines = machineIds.length
    ? await ctx.db
        .query('chatroom_machines')
        .withIndex('by_userId', (q) => q.eq('userId', input.userId))
        .collect()
    : [];
  const machineNames = new Map(
    machines.filter((m) => machineIds.includes(m.machineId)).map((m) => [m.machineId, m.hostname])
  );
  const firstUserMessage = await ctx.db
    .query('chatroom_messages')
    .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
      q.eq('chatroomId', input.chatroomId).eq('senderRole', 'user').eq('type', 'message')
    )
    .first();
  const agents = teamRoles.map((role): AgentViewRole => {
    const row = rowByRole.get(role.toLowerCase());
    const participant = participantByRole.get(role.toLowerCase());
    const lastStatus = participant?.lastStatus ?? null;
    const inferred = row
      ? deriveAgentRoleViewState(
          {
            desiredState: row.operationalState === 'circuit_open' ? 'stopped' : 'running',
            circuitState: row.operationalState === 'circuit_open' ? 'open' : 'closed',
            spawnedAgentPid: row.isAlive ? 1 : null,
          },
          row.daemonConnected,
          lastStatus
        )
      : 'stopped';
    // Participant transitions can race projection writes; retain the established starting signal.
    const projectedState = row?.viewState === 'idle' ? undefined : row?.viewState;
    const state =
      projectedState === 'stopped' && inferred === 'starting'
        ? 'starting'
        : (projectedState ?? inferred);
    return {
      role,
      state,
      type: (participant?.agentType ?? 'remote') as AgentType,
      machineId: row?.machineId,
      machineName: row?.machineId ? machineNames.get(row.machineId) : undefined,
      lastSeenAt: participant?.lastSeenAt ?? null,
      lastSeenAction: participant?.lastSeenAction ?? null,
      stopState: row?.stopState,
      activeStopCommandId: row?.activeStopCommandId,
    };
  });
  return {
    teamId: chatroom.teamId,
    teamName: chatroom.teamName ?? chatroom.teamId,
    teamRoles,
    agents,
    hasHistory: firstUserMessage !== null,
    hasActiveEnhancerWork: await hasActiveEnhancerWork(ctx, input.chatroomId),
  };
}

async function getMachineHostname(ctx: QueryCtx, machineId: string): Promise<string | undefined> {
  const identity = await ctx.db
    .query('chatroom_machineIdentity')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  return identity?.hostname;
}

export async function getAgentViewStatus(
  ctx: QueryCtx,
  input: { chatroomId: Id<'chatroom_rooms'>; userId: Id<'users'> }
): Promise<AgentViewStatus | null> {
  const metadata = await ctx.db
    .query('chatroom_agentViewMetadata')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId))
    .first();
  if (!metadata) return getAgentViewStatusLegacy(ctx, input);
  if (metadata.ownerId !== input.userId || !metadata.teamId || metadata.teamRoles.length === 0)
    return null;
  const rows = await ctx.db
    .query('chatroom_agentRoleOperationalStatus')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId))
    .collect();
  const participants = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId))
    .collect();
  const rowByRole = new Map(rows.map((r) => [r.role.toLowerCase(), r]));
  const participantByRole = new Map(participants.map((p) => [p.role.toLowerCase(), p]));
  const machineNames = new Map<string, string>();
  for (const machineId of [...new Set(rows.flatMap((r) => (r.machineId ? [r.machineId] : [])))]) {
    const hostname = await getMachineHostname(ctx, machineId);
    if (hostname) machineNames.set(machineId, hostname);
  }
  const agents = metadata.teamRoles.map((role): AgentViewRole => {
    const row = rowByRole.get(role.toLowerCase());
    const participant = participantByRole.get(role.toLowerCase());
    const lastStatus = participant?.lastStatus ?? null;
    const inferred = row
      ? deriveAgentRoleViewState(
          {
            desiredState: row.operationalState === 'circuit_open' ? 'stopped' : 'running',
            circuitState: row.operationalState === 'circuit_open' ? 'open' : 'closed',
            spawnedAgentPid: row.isAlive ? 1 : null,
          },
          row.daemonConnected,
          lastStatus
        )
      : 'stopped';
    const projectedState = row?.viewState === 'idle' ? undefined : row?.viewState;
    const state =
      projectedState === 'stopped' && inferred === 'starting'
        ? 'starting'
        : (projectedState ?? inferred);
    return {
      role,
      state,
      type: (participant?.agentType ?? 'remote') as AgentType,
      machineId: row?.machineId,
      machineName: row?.machineId ? machineNames.get(row.machineId) : undefined,
      lastSeenAt: participant?.lastSeenAt ?? null,
      lastSeenAction: participant?.lastSeenAction ?? null,
      stopState: row?.stopState,
      activeStopCommandId: row?.activeStopCommandId,
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
