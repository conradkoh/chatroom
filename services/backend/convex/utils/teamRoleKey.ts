import type { Id } from '../_generated/dataModel';

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
