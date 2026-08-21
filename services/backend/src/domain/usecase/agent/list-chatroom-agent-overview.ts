/**
 * Use Case: List Chatroom Agent Overview
 *
 * Returns a per-chatroom summary of agent status for all chatrooms owned
 * by a user. Used by the chatroom listing sidebar to show running/stopped
 * indicators without leaking machine-level details.
 *
 * An agent is considered "running" only if it has a spawned PID AND its
 * daemon is connected. This matches the frontend AgentConfigTabs logic.
 *
 * Reads materialized chatroom summaries first, filtering machine ownership at
 * read time. A config-based fallback remains for pre-backfill chatrooms.
 */

import { isAgentAlive } from './is-agent-alive';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RunningAgentInfo {
  role: string;
  machineId: string;
}

export interface ChatroomAgentOverview {
  chatroomId: Id<'chatroom_rooms'>;
  agentStatus: 'running' | 'stopped' | 'none';
  runningRoles: string[];
  /**
   * Roles whose agent has a spawned PID regardless of daemon connectivity.
   * Mirrors getTeamLifecycle `isAlive` (`isAgentAlive(spawnedAgentPid)`) so the
   * listing dots align with the agent panel while agents are spawned and working.
   */
  aliveRoles: string[];
  /** Includes machineId for operational commands (start/stop). */
  runningAgents: RunningAgentInfo[];
}

export interface ListChatroomAgentOverviewInput {
  userId: Id<'users'>;
}

export type OverviewMachineMap = Map<string, { machineId: string }>;

/** Resolve one room; summary rows are the primary source and legacy derivation is fallback. */
export async function getChatroomAgentOverviewForRoom(
  ctx: QueryCtx,
  room: { _id: Id<'chatroom_rooms'>; teamId?: string | null },
  machineMap: OverviewMachineMap
): Promise<ChatroomAgentOverview> {
  const summary = await ctx.db
    .query('chatroom_agentOperationalSummary')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', room._id))
    .first();
  if (summary) {
    const runningAgents = summary.runningAgents.filter((agent) => machineMap.has(agent.machineId));
    const runningRoles = runningAgents.map((agent) => agent.role);
    const aliveRoles: string[] = [];
    for (const role of summary.aliveRoles) {
      const row = await ctx.db
        .query('chatroom_agentRoleOperationalStatus')
        .withIndex('by_chatroom_role', (q) =>
          q.eq('chatroomId', room._id).eq('role', role.toLowerCase())
        )
        .first();
      if (row?.machineId && machineMap.has(row.machineId)) aliveRoles.push(role);
    }
    const agentStatus =
      summary.remoteConfigCount === 0
        ? ('none' as const)
        : runningRoles.length > 0
          ? ('running' as const)
          : ('stopped' as const);
    return { chatroomId: room._id, agentStatus, runningRoles, aliveRoles, runningAgents };
  }
  const allConfigs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', room._id))
    .collect();
  const configs = allConfigs.filter((c) => {
    if (!c.machineId || !machineMap.has(c.machineId)) return false;
    if (room.teamId && c.teamRoleKey)
      return c.teamRoleKey.includes(`#team_${room.teamId.toLowerCase()}#`);
    return true;
  });
  const statusMap = new Map<string, boolean>();
  for (const config of configs) {
    if (!config.machineId || statusMap.has(config.machineId)) continue;
    const status = await ctx.db
      .query('chatroom_machineStatus')
      .withIndex('by_machineId', (q) => q.eq('machineId', config.machineId!))
      .first();
    statusMap.set(config.machineId, status?.status === 'online');
  }
  const runningConfigs = configs.filter(
    (c) => c.spawnedAgentPid != null && c.machineId != null && statusMap.get(c.machineId) === true
  );
  return {
    chatroomId: room._id,
    agentStatus: configs.length === 0 ? 'none' : runningConfigs.length > 0 ? 'running' : 'stopped',
    runningRoles: runningConfigs.map((c) => c.role),
    aliveRoles: configs.filter((c) => isAgentAlive(c.spawnedAgentPid)).map((c) => c.role),
    runningAgents: runningConfigs.map((c) => ({ role: c.role, machineId: c.machineId ?? '' })),
  };
}

// ─── Use Case ────────────────────────────────────────────────────────────────

export async function listChatroomAgentOverview(
  ctx: QueryCtx,
  input: ListChatroomAgentOverviewInput
): Promise<ChatroomAgentOverview[]> {
  // Get all chatrooms owned by the user
  const userChatrooms = await ctx.db
    .query('chatroom_rooms')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', input.userId))
    .collect();

  // Pre-fetch all user machines for ownership check (static data only)
  const userMachines = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_userId', (q) => q.eq('userId', input.userId))
    .collect();
  const machineMap = new Map(userMachines.map((m) => [m.machineId, m]));

  const results = await Promise.all(
    userChatrooms.map((room) => getChatroomAgentOverviewForRoom(ctx, room, machineMap))
  );
  return results;
  /*
    userChatrooms.map(async (room) => {
      const summary = await ctx.db
        .query('chatroom_agentOperationalSummary')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', room._id))
        .first();

      if (summary) {
        const runningAgents = summary.runningAgents.filter((agent) =>
          machineMap.has(agent.machineId)
        );
        const runningRoles = runningAgents.map((agent) => agent.role);
        const aliveRoles: string[] = [];
        for (const role of summary.aliveRoles) {
          const row = await ctx.db
            .query('chatroom_agentRoleOperationalStatus')
            .withIndex('by_chatroom_role', (q) =>
              q.eq('chatroomId', room._id).eq('role', role.toLowerCase())
            )
            .first();
          if (row?.machineId && machineMap.has(row.machineId)) aliveRoles.push(role);
        }
        const agentStatus =
          summary.remoteConfigCount === 0
            ? ('none' as const)
            : runningRoles.length > 0
              ? ('running' as const)
              : ('stopped' as const);
        return { chatroomId: room._id, agentStatus, runningRoles, aliveRoles, runningAgents };
      }

      // Fallback for chatrooms that have not been backfilled yet.
      const allConfigs = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', room._id))
        .collect();

      // Filter to only configs for the CURRENT team and user-owned machines.
      // This matches the filtering in getMachineAgentConfigs (convex/machines.ts)
      // so the sidebar status aligns with the per-agent settings panel.
      // Stale configs from old teams (after a team switch) are excluded to
      // prevent the sidebar from seeing spawnedAgentPid on old-team configs.
      const currentTeamId = room.teamId;
      const configs = allConfigs.filter((c) => {
        // Only include configs for machines the user owns
        if (!c.machineId || !machineMap.has(c.machineId)) return false;
        // Only include configs for the current team
        if (currentTeamId && c.teamRoleKey) {
          return c.teamRoleKey.includes(`#team_${currentTeamId.toLowerCase()}#`);
        }
        return true;
      });

      const statusMap = new Map<string, boolean>();
      for (const config of configs) {
        if (!config.machineId || statusMap.has(config.machineId)) continue;
        const machineStatus = await ctx.db
          .query('chatroom_machineStatus')
          .withIndex('by_machineId', (q) => q.eq('machineId', config.machineId!))
          .first();
        statusMap.set(config.machineId, machineStatus?.status === 'online');
      }

      // An agent is only considered running if it has a PID AND its daemon is connected.
      // This matches the frontend AgentConfigTabs check (spawnedAgentPid && daemonConnected)
      // and prevents stale "running" status when a daemon disconnects without cleanup.
      const runningConfigs = configs.filter((c) => {
        if (c.spawnedAgentPid == null) return false;
        if (c.machineId == null) return false;
        return statusMap.get(c.machineId) === true;
      });

      let agentStatus: ChatroomAgentOverview['agentStatus'];
      if (configs.length === 0) {
        // No team agent config has ever been written for this chatroom.
        agentStatus = 'none';
      } else {
        agentStatus = runningConfigs.length > 0 ? 'running' : 'stopped';
      }

      const runningRoles = runningConfigs.map((c) => c.role);
      const runningAgents = runningConfigs.map((c) => ({
        role: c.role,
        machineId: c.machineId ?? '',
      }));

      // Alive = spawned PID, regardless of daemon connectivity (matches
      // getTeamLifecycle / agent panel isAlive). Unlike runningRoles, this is
      // NOT gated on daemon-connected so working agents don't show grey idle.
      const aliveRoles = configs.filter((c) => isAgentAlive(c.spawnedAgentPid)).map((c) => c.role);

      return {
        chatroomId: room._id,
        agentStatus,
        runningRoles,
        aliveRoles,
        runningAgents,
      };
    })
  );
  */
}
