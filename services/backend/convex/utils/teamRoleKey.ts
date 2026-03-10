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
 * Deletes all existing chatroom_teamAgentConfigs rows with the given teamRoleKey.
 * Call this before inserting a new row to enforce uniqueness at write time.
 */
export async function deleteStaleTeamAgentConfigs(
  ctx: MutationCtx,
  teamRoleKey: string
): Promise<void> {
  const stale = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .collect();
  for (const row of stale) {
    await ctx.db.delete('chatroom_teamAgentConfigs', row._id);
  }
}
