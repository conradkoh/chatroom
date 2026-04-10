/**
 * Use Case: Get Agent Status for Chatroom
 *
 * Returns a role-centric view of agent status for a chatroom, suitable for
 * the UI. Reads from teamAgentConfigs (the authoritative source for model,
 * workingDir, spawnedAgentPid, spawnedAt) so the frontend never needs to see
 * raw table records.
 *
 * An agent is considered "running" only if it has a spawned PID AND its
 * daemon is connected. This matches the logic in list-chatroom-agent-overview.ts
 * and prevents stale "running" status when a daemon disconnects without cleanup.
 *
 * Workspace listing is now handled by the workspace registry
 * (chatroom_workspaces table + useChatroomWorkspaces hook).
 */

import { getTeamRolesFromChatroom } from './get-team-roles';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import type { AgentHarness, AgentType } from '../../entities/agent';

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

/** Full chatroom agent status returned to the UI. */
export interface ChatroomAgentStatus {
  teamRoles: string[];
  agents: AgentRoleView[];
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

  // Read status from materialized machineStatus table
  const statusMap = new Map<string, { daemonConnected: boolean }>();
  for (const machine of userMachines) {
    const machineStatus = await ctx.db
      .query('chatroom_machineStatus')
      .withIndex('by_machineId', (q: any) => q.eq('machineId', machine.machineId))
      .first();
    statusMap.set(machine.machineId, { daemonConnected: machineStatus?.status === 'online' });
  }

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

    const machine = teamConfig.machineId ? userMachineMap.get(teamConfig.machineId) : undefined;

    // Check daemon connectivity for this agent's machine
    const machineStatus = teamConfig.machineId ? statusMap.get(teamConfig.machineId) : undefined;
    const daemonConnected = machineStatus?.daemonConnected ?? false;

    // Determine state
    // An agent is only considered "running" if it has a PID AND its daemon is connected.
    // This prevents stale "running" status when a daemon disconnects without cleanup.
    let state: AgentRoleView['state'] = 'stopped';

    if (teamConfig.circuitState === 'open') {
      state = 'circuit_open';
    } else if (teamConfig.desiredState === 'running') {
      if (teamConfig.spawnedAgentPid != null && daemonConnected) {
        state = 'running';
      } else if (teamConfig.spawnedAgentPid != null && !daemonConnected) {
        // Daemon is offline but PID exists — agent cannot be running
        state = 'stopped';
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

  return {
    teamRoles,
    agents,
  };
}
