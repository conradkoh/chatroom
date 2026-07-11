import type { ChatroomWithStatus } from '../context/ChatroomListingContext';
import { getChatroomDisplayName } from '../viewModels/chatroomViewModel';

export function buildHandoffNotificationContent(
  chatroom: Pick<ChatroomWithStatus, 'name' | 'teamName'>
): { title: string; body: string } {
  const name = getChatroomDisplayName(chatroom);
  return {
    title: `${name} Handoff`,
    body: 'Tasks complete.',
  };
}
