import { fuzzyFilter } from '@/lib/fuzzyMatch';
import type { ChatroomWithStatus } from '@/modules/chatroom/context/ChatroomListingContext';
import { getChatroomDisplayName } from '@/modules/chatroom/viewModels/chatroomViewModel';

export const CHATROOM_SWITCHER_ITEM_ROW_HEIGHT = 32;
export const CHATROOM_SWITCHER_HEADING_ROW_HEIGHT = 28;

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
export function scoreChatroomForSearch(chatroom: ChatroomWithStatus, search: string): number {
  const keywords = getChatroomSwitcherKeywords(chatroom);
  const displayName = getChatroomDisplayName(chatroom);
  return Math.max(
    fuzzyFilter(chatroom._id, search, keywords),
    fuzzyFilter(displayName, search, keywords)
  );
}

// fallow-ignore-next-line unused-export — consumed by unit tests
export function filterChatroomsForSearch(
  chatrooms: ChatroomWithStatus[],
  search: string
): ChatroomWithStatus[] {
  const q = search.trim();
  if (!q) return chatrooms;
  return chatrooms
    .map((chatroom) => ({ chatroom, score: scoreChatroomForSearch(chatroom, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.chatroom);
}

export function buildChatroomSwitcherRows(
  chatrooms: ChatroomWithStatus[],
  search: string
): ChatroomSwitcherRow[] {
  const filtered = filterChatroomsForSearch(chatrooms, search);
  const isSearching = search.trim().length > 0;
  const rows: ChatroomSwitcherRow[] = [];
  if (!isSearching && filtered.length > 0) {
    rows.push({ type: 'heading', id: 'chatrooms', label: 'Chatrooms' });
  }
  for (const chatroom of filtered) {
    rows.push({ type: 'item', id: chatroom._id, chatroom });
  }
  return rows;
}
