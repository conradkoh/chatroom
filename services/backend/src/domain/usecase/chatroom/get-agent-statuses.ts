/**
 * Use Case: Get Agent Status for Chatroom
 *
 * Returns a role-centric view of agent status for a chatroom, suitable for
 * the UI. Reads from teamAgentConfigs (the authoritative source for model,
 * workingDir, spawnedAgentPid, spawnedAt) so the frontend never needs to see
 * raw table records.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import type { AgentHarness, AgentType } from '../../entities/agent';
import { getTeamRolesFromChatroom } from './get-team-roles';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single agent's status as presented to the UI. No internal IDs exposed. */
export interface AgentRoleView {
  role: string;
  state: 'running' | 'stopped' | 'starting' | 'circuit_open';
  type: AgentType;
  machineName?: string;
  agentHarness?: AgentHarness;
  model?: string;
  workingDir?: string;
  spawnedAt?: number;
}

/** Workspace view derived from team agent configs. */
export interface WorkspaceView {
  hostname: string;
  workingDir: string;
  agentRoles: string[];
}

/** Full chatroom agent status returned to the UI. */
export interface ChatroomAgentStatus {
  teamRoles: string[];
  agents: AgentRoleView[];
  workspaces: WorkspaceView[];
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

  // Fetch team agent configs for this chatroom
  const teamConfigs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId))
    .collect();

  const teamConfigByRole = new Map(teamConfigs.map((c) => [c.role.toLowerCase(), c]));

  // Only include configs for the user's machines
  const userMachines = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_userId', (q) => q.eq('userId', input.userId))
    .collect();
  const userMachineMap = new Map(userMachines.map((m) => [m.machineId, m]));

  // Build the agent role views
  const agents: AgentRoleView[] = teamRoles.map((role) => {
    const roleLower = role.toLowerCase();
    const teamConfig = teamConfigByRole.get(roleLower);

    if (!teamConfig) {
      return {
        role,
        state: 'stopped' as const,
        type: 'remote' as AgentType,
      };
    }

    const machine = teamConfig.machineId
      ? userMachineMap.get(teamConfig.machineId)
      : undefined;

    // Determine state
    let state: AgentRoleView['state'] = 'stopped';

    if (teamConfig.circuitState === 'open') {
      state = 'circuit_open';
    } else if (teamConfig.desiredState === 'running') {
      if (teamConfig.spawnedAgentPid != null) {
        state = 'running';
      } else {
        state = 'starting';
      }
    }

    const model = teamConfig.model;

    return {
      role,
      state,
      type: teamConfig.type,
      machineName: machine?.hostname,
      agentHarness: teamConfig.agentHarness as AgentHarness | undefined,
      model,
      workingDir: teamConfig.workingDir,
      spawnedAt: teamConfig.spawnedAt,
    };
  });

  // Derive workspaces from team configs
  const workspaceMap = new Map<string, WorkspaceView>();
  for (const teamConfig of teamConfigs) {
    if (!teamConfig.machineId || !teamConfig.workingDir) continue;
    if (!teamRoles.some((r) => r.toLowerCase() === teamConfig.role.toLowerCase())) continue;

    const machine = userMachineMap.get(teamConfig.machineId);
    const hostname = machine?.hostname ?? teamConfig.machineId.slice(0, 8);
    const wsKey = `${teamConfig.machineId}::${teamConfig.workingDir}`;

    if (!workspaceMap.has(wsKey)) {
      workspaceMap.set(wsKey, {
        hostname,
        workingDir: teamConfig.workingDir,
        agentRoles: [],
      });
    }
    workspaceMap.get(wsKey)!.agentRoles.push(teamConfig.role);
  }

  return {
    teamRoles,
    agents,
    workspaces: Array.from(workspaceMap.values()),
  };
}
