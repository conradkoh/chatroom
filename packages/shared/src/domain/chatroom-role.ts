import { normalizeAgentRole } from './agent-role';

/** Lowercase chatroom participant role identifier (agent roles, user, and custom roles). */
export type ChatroomRole = string;

export const CHATROOM_ROLE_USER = 'user' as const;
export type ChatroomUserRole = typeof CHATROOM_ROLE_USER;

/** Normalize a raw role string to lowercase trimmed form for comparisons. */
export function normalizeChatroomRole(role: string): ChatroomRole {
  return normalizeAgentRole(role);
}

export function isChatroomUserRole(role: string): role is ChatroomUserRole {
  return normalizeChatroomRole(role) === CHATROOM_ROLE_USER;
}
