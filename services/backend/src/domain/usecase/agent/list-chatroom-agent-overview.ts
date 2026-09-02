/**
 * Use Case: List Chatroom Agent Overview
 *
 * Reads the owner-scoped materialized sidebar read model.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

export interface RunningAgentInfo {
  role: string;
  machineId: string;
}
export interface ChatroomAgentOverview {
  chatroomId: Id<'chatroom_rooms'>;
  agentStatus: 'running' | 'stopped' | 'none';
  runningRoles: string[];
  aliveRoles: string[];
  runningAgents: RunningAgentInfo[];
}
export interface ListChatroomAgentOverviewInput {
  userId: Id<'users'>;
}
export type OverviewMachineMap = Map<string, { machineId: string }>;

/** Resolve one room from the materialized projection. */
export async function getChatroomAgentOverviewForRoom(
  ctx: QueryCtx,
  room: { _id: Id<'chatroom_rooms'>; teamId?: string | null | undefined },
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
  return {
    chatroomId: room._id,
    agentStatus: 'none',
    runningRoles: [],
    aliveRoles: [],
    runningAgents: [],
  };
}

export async function listChatroomAgentOverview(
  ctx: QueryCtx,
  input: ListChatroomAgentOverviewInput
): Promise<ChatroomAgentOverview[]> {
  const summaries = await ctx.db
    .query('chatroom_agentOperationalSummary')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', input.userId))
    .collect();
  return summaries.map(({ chatroomId, agentStatus, runningRoles, aliveRoles, runningAgents }) => ({
    chatroomId,
    agentStatus,
    runningRoles,
    aliveRoles,
    runningAgents,
  }));
}
