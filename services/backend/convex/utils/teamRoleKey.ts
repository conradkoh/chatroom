import type { Id } from '../_generated/dataModel';

/**
 * Builds a unique key scoped to a chatroom+role for use in chatroom_teamAgentConfigs.
 * Format: `chatroom_<chatroomId>#role_<role.toLowerCase()>`
 */
export function buildTeamRoleKey(chatroomId: Id<'chatroom_rooms'> | string, role: string): string {
  return `chatroom_${chatroomId}#role_${role.toLowerCase()}`;
}
