/**
 * Use Case: Get Agent Status for Chatroom
 *
 * Returns a role-centric view of agent status for a chatroom, suitable for
 * the UI. Reads from teamAgentConfigs (the authoritative source for model,
 * workingDir, spawnedAgentPid, spawnedAt) so the frontend never needs to see
 * raw table records. Operational state is read from the materialized
 * chatroom_agentRoleOperationalStatus projection; config metadata remains
 * sourced from the per-role team config.
 *
 * Workspace listing is now handled by the workspace registry
 * (chatroom_workspaces table + useChatroomWorkspaces hook).
 */

import { getTeamRolesFromChatroom } from './get-team-roles';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import type { AgentHarness, AgentType } from '../../entities/agent';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single agent's status as presented to the UI. No internal IDs exposed. */
export interface AgentRoleView {
  role: string;
  state: 'running' | 'stopped' | 'starting' | 'circuit_open';
  type: AgentType;
  machineId?: string;
  machineName?: string;
  agentHarness?: AgentHarness;
  model?: string;
  workingDir?: string;
  spawnedAt?: number;
  /** When true (default), stop→start reconnects to the daemon's preserved session. */
  wantResume?: boolean;
}

/** Full chatroom agent status returned to the UI. */
export interface ChatroomAgentStatus {
  teamRoles: string[];
  agents: AgentRoleView[];
  teamId?: string;
}

export interface GetAgentStatusInput {
  chatroomId: Id<'chatroom_rooms'>;
  userId: Id<'users'>;
}

// ─── Use Case ────────────────────────────────────────────────────────────────

export async function getAgentStatusForChatroom(
  ctx: QueryCtx,
  input: GetAgentStatusInput
): Promise<ChatroomAgentStatus | null> {
  const chatroom = await ctx.db.get('chatroom_rooms', input.chatroomId);
  if (!chatroom || chatroom.ownerId !== input.userId) {
    return null;
  }

  const { teamRoles } = getTeamRolesFromChatroom(chatroom);

  // Only include configs for the user's machines
  const userMachines = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_userId', (q) => q.eq('userId', input.userId))
    .collect();
  const userMachineMap = new Map(userMachines.map((m) => [m.machineId, m]));

  // Build the agent role views
  const agents: AgentRoleView[] = await Promise.all(
    teamRoles.map(async (role) => {
      const roleLower = role.toLowerCase();
      const opRow = await ctx.db
        .query('chatroom_agentRoleOperationalStatus')
        .withIndex('by_chatroom_role', (q) =>
          q.eq('chatroomId', input.chatroomId).eq('role', roleLower)
        )
        .first();

      if (!chatroom.teamId) {
        return { role, state: 'stopped' as const, type: 'remote' as AgentType };
      }
      const teamId = chatroom.teamId;

      const teamConfig = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(input.chatroomId, teamId, role))
        )
        .first();

      if (!teamConfig || !teamConfig.machineId || !userMachineMap.has(teamConfig.machineId)) {
        return {
          role,
          state: (opRow?.operationalState ?? 'stopped') as AgentRoleView['state'],
          type: 'remote' as AgentType,
        };
      }

      const machine = teamConfig.machineId ? userMachineMap.get(teamConfig.machineId) : undefined;
      const state = (opRow?.operationalState ?? 'stopped') as AgentRoleView['state'];

      const model = teamConfig.model;

      return {
        role,
        state,
        type: teamConfig.type,
        machineId: teamConfig.machineId,
        machineName: machine?.hostname,
        agentHarness: teamConfig.agentHarness as AgentHarness | undefined,
        model,
        workingDir: teamConfig.workingDir,
        spawnedAt: teamConfig.spawnedAt,
        wantResume: teamConfig.wantResume,
      };
    })
  );

  return {
    teamRoles,
    agents,
    teamId: chatroom.teamId,
  };
}
