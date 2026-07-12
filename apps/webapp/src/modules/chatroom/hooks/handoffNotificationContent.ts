import type { ChatroomWithStatus } from '../context/ChatroomListingContext';

export function buildHandoffNotificationContent(
  chatroom: Pick<ChatroomWithStatus, 'name' | 'teamName'>
): { title: string; body: string } {
  const name = chatroom.name?.trim();
  const teamName = chatroom.teamName?.trim();
  const title = name ? `${name} Handoff` : teamName ? `${teamName} Handoff` : 'Handoff';
  return {
    title,
    body: 'Tasks complete.',
  };
}
