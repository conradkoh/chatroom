import type { ChatroomWithStatus } from '../context/ChatroomListingContext';

export function buildHandoffNotificationContent(
  chatroom: Pick<ChatroomWithStatus, 'name' | 'teamName'>
): { title: string; body: string } {
  const name = chatroom.name?.trim();
  const teamName = chatroom.teamName?.trim();
  const displayName = name || teamName;
  const title = displayName || 'Chatroom';
  return {
    title,
    body: 'Tasks complete',
  };
}
