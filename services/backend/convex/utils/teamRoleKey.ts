import { AGENT_REQUEST_DEADLINE_MS } from '../../config/reliability';
import { emitConfigRemoval } from '../../src/domain/usecase/agent/config-removal';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/**
 * Builds a unique key scoped to a chatroom+team+role for use in chatroom_teamAgentConfigs.
 * Format: `chatroom_<chatroomId>#team_<teamId>#role_<role.toLowerCase()>`
 *
 * Including teamId ensures that configs are invalidated when a chatroom switches team
 * structure (e.g., from 'duo' to 'squad'), since the role semantics differ between teams.
 *
 * @param chatroomId - The chatroom ID
 * @param teamId - The team type (e.g., 'duo', 'squad', 'pair'). Must not be empty — callers
 *   should throw if chatroom.teamId is undefined rather than passing a fallback value.
 * @param role - The agent role (e.g., 'planner', 'builder')
 */
export function buildTeamRoleKey(
  chatroomId: Id<'chatroom_rooms'> | string,
  teamId: string,
  role: string
): string {
  return `chatroom_${chatroomId}#team_${teamId.toLowerCase()}#role_${role.toLowerCase()}`;
}

/**
 * Removes stale chatroom_teamAgentConfigs rows with the given teamRoleKey.
 * For configs with a running process, emits stop + removal events instead of
 * deleting directly, so the process lifecycle is respected.
 */
export async function deleteStaleTeamAgentConfigs(
  ctx: MutationCtx,
  teamRoleKey: string
): Promise<void> {
  const stale = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .collect();
  const now = Date.now();
  for (const row of stale) {
    if (row.spawnedAgentPid != null && row.machineId) {
      await ctx.db.insert('chatroom_eventStream', {
        type: 'agent.requestStop',
        chatroomId: row.chatroomId,
        machineId: row.machineId,
        role: row.role,
        reason: 'platform.dedup',
        deadline: now + AGENT_REQUEST_DEADLINE_MS,
        timestamp: now,
      });
      await emitConfigRemoval(ctx, {
        chatroomId: row.chatroomId,
        role: row.role,
        machineId: row.machineId,
        reason: 'stale_duplicate',
      });
    } else {
      await ctx.db.delete('chatroom_teamAgentConfigs', row._id);
    }
  }
}
