import type { ChatroomWithStatus } from '../../context/ChatroomListingContext';

import type { ChatroomStatus } from '@/domain/entities/chatroom-status';

export type TabType = 'current' | 'complete';
export type ViewMode = 'grid' | 'table';

/**
 * Filters chatrooms by a search query.
 * Matches against chatroom name, team name, and ID (case-insensitive).
 */
export function filterChatrooms(
  chatrooms: ChatroomWithStatus[],
  query: string
): ChatroomWithStatus[] {
  const lower = query.toLowerCase().trim();
  if (!lower) return chatrooms;

  return chatrooms.filter((c) =>
    [c.name, c.teamName, c._id].some((field) => (field ?? '').toLowerCase().includes(lower))
  );
}

/** Custom name when set, otherwise the team name, otherwise 'Team'. */
export function chatroomDisplayName(
  chatroom: Pick<ChatroomWithStatus, 'name' | 'teamName'>
): string {
  return chatroom.name || chatroom.teamName || 'Team';
}

/** Completed when either the listing or the live status says so. */
export function isChatroomCompleted(
  chatroom: Pick<ChatroomWithStatus, 'status'>,
  state: ChatroomStatus['state'] | undefined
): boolean {
  return chatroom.status === 'completed' || state === 'completed';
}

/** The Current tab shows chatrooms that are not completed. The Complete tab shows the rest. */
export function isChatroomShownInTab(
  chatroom: Pick<ChatroomWithStatus, 'status'>,
  state: ChatroomStatus['state'] | undefined,
  activeTab: TabType
): boolean {
  const completed = isChatroomCompleted(chatroom, state);
  return activeTab === 'current' ? !completed : completed;
}
