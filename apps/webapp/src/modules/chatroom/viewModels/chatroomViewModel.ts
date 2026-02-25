import type { ChatroomWithStatus } from '../context/ChatroomListingContext';

/**
 * Returns the display name for a chatroom, with consistent fallback logic.
 * Priority: chatroom name → team name → generic 'Chatroom'
 */
export function getChatroomDisplayName(
  chatroom: Pick<ChatroomWithStatus, 'name' | 'teamName'>
): string {
  return chatroom.name || chatroom.teamName || 'Chatroom';
}
