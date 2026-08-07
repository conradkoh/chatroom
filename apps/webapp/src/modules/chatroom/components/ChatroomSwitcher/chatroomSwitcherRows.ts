import { fuzzyFilter } from '@/lib/fuzzyMatch';
import type { ChatroomWithStatus } from '@/modules/chatroom/context/ChatroomListingContext';
import { getChatroomDisplayName } from '@/modules/chatroom/viewModels/chatroomViewModel';

export type ChatroomSwitcherRow =
  | { type: 'heading'; id: string; label: string }
  | { type: 'item'; id: string; chatroom: ChatroomWithStatus };

export function getChatroomSwitcherKeywords(
  chatroom: Pick<ChatroomWithStatus, 'name' | 'teamName'>
): string[] {
  const displayName = getChatroomDisplayName(chatroom);
  if (chatroom.teamName && chatroom.teamName !== displayName) {
    return [displayName, chatroom.teamName];
  }
  return [displayName];
}

// fallow-ignore-next-line unused-export — consumed by unit tests
export function filterChatroomsForSearch(
  chatrooms: ChatroomWithStatus[],
  search: string
): ChatroomWithStatus[] {
  const q = search.trim();
  if (!q) return chatrooms;
  return chatrooms
    .map((chatroom) => {
      const keywords = getChatroomSwitcherKeywords(chatroom);
      const score = fuzzyFilter(chatroom._id, q, keywords);
      return { chatroom, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ chatroom }) => chatroom);
}

export function buildChatroomSwitcherRows(
  chatrooms: ChatroomWithStatus[],
  search: string
): ChatroomSwitcherRow[] {
  const isSearching = search.trim().length > 0;
  const filtered = filterChatroomsForSearch(chatrooms, search);
  const rows: ChatroomSwitcherRow[] = [];
  if (!isSearching) {
    rows.push({ type: 'heading', id: 'chatrooms', label: 'Chatrooms' });
  }
  for (const chatroom of filtered) {
    rows.push({ type: 'item', id: chatroom._id, chatroom });
  }
  return rows;
}
