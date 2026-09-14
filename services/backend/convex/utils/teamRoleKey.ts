import type { Id } from '../_generated/dataModel';

/** Stable key for legacy task/config fixtures and team-scoped indexes. */
export function buildTeamRoleKey(
  chatroomId: Id<'chatroom_rooms'> | string,
  teamId: string,
  role: string
): string {
  return `chatroom_${chatroomId}#team_${teamId.toLowerCase()}#role_${role.toLowerCase()}`;
}
