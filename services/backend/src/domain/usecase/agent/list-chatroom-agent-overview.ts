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
