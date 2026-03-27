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
 * Reads from chatroom_teamAgentConfigs + chatroom_machines (daemon connectivity).
 * Replaces `listRemoteAgentRunningStatus` which exposed raw machineId+role
 * tuples to the frontend.
 */

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
  /** Includes machineId for operational commands (start/stop). */
  runningAgents: RunningAgentInfo[];
}

export interface ListChatroomAgentOverviewInput {
  userId: Id<'users'>;
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

  // Pre-fetch all user machines for daemon connectivity check
  const userMachines = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_userId', (q) => q.eq('userId', input.userId))
    .collect();
  const machineMap = new Map(userMachines.map((m) => [m.machineId, m]));

  const results = await Promise.all(
    userChatrooms.map(async (room) => {
      const configs = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', room._id))
        .collect();

      // An agent is only considered running if it has a PID AND its daemon is connected.
      // This matches the frontend AgentConfigTabs check (spawnedAgentPid && daemonConnected)
      // and prevents stale "running" status when a daemon disconnects without cleanup.
      const runningConfigs = configs.filter((c) => {
        if (c.spawnedAgentPid == null) return false;
        const machine = c.machineId ? machineMap.get(c.machineId) : undefined;
        return machine?.daemonConnected === true;
      });

      const agentStatus: ChatroomAgentOverview['agentStatus'] =
        configs.length === 0 ? 'none' : runningConfigs.length > 0 ? 'running' : 'stopped';

      const runningRoles = runningConfigs.map((c) => c.role);
      const runningAgents = runningConfigs.map((c) => ({
        role: c.role,
        machineId: c.machineId ?? '',
      }));

      return {
        chatroomId: room._id,
        agentStatus,
        runningRoles,
        runningAgents,
      };
    })
  );

  return results;
}
