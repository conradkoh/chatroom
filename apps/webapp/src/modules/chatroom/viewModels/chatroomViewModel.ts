import type { ChatroomWithStatus } from '../context/ChatroomListingContext';

import type { ChatroomStatus } from '@/domain/entities/chatroom-status';

/**
 * Returns the display name for a chatroom, with consistent fallback logic.
 * Priority: chatroom name → team name → generic 'Chatroom'
 */
export function getChatroomDisplayName(
  chatroom: Pick<ChatroomWithStatus, 'name' | 'teamName'>
): string {
  return chatroom.name || chatroom.teamName || 'Chatroom';
}

/**
 * Completed when either the listing or the live status says so. Every chatroom list, the sidebar
 * and the archive check use this rule.
 */
export function isChatroomCompleted(
  chatroom: Pick<ChatroomWithStatus, 'status'>,
  state: ChatroomStatus['state'] | undefined
): boolean {
  return chatroom.status === 'completed' || state === 'completed';
}
