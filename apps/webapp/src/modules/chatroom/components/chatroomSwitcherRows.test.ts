import { describe, expect, it } from 'vitest';

import {
  buildChatroomSwitcherRows,
  filterChatroomsForSearch,
  getChatroomSwitcherKeywords,
} from './chatroomSwitcherRows';

import type { ChatroomWithStatus } from '@/modules/chatroom/context/ChatroomListingContext';

function makeChatroom(
  overrides: Partial<ChatroomWithStatus> & Pick<ChatroomWithStatus, '_id'>
): ChatroomWithStatus {
  return {
    _creationTime: Date.now(),
    status: 'active',
    chatStatus: 'idle',
    teamId: 'team-1',
    teamName: 'Team',
    teamRoles: [],
    agents: [],
    isFavorite: false,
    hasUnread: false,
    hasUnreadHandoff: false,
    remoteAgentStatus: 'none',
    runningRoles: [],
    runningAgentConfigs: [],
    ...overrides,
  };
}

describe('getChatroomSwitcherKeywords', () => {
  it('returns display name plus team name when distinct', () => {
    const chatroom = makeChatroom({ _id: 'c1', name: 'Project Alpha', teamName: 'Acme' });
    expect(getChatroomSwitcherKeywords(chatroom)).toEqual(['Project Alpha', 'Acme']);
  });

  it('returns only display name when team name matches', () => {
    const chatroom = makeChatroom({ _id: 'c1', name: 'Project Alpha', teamName: 'Project Alpha' });
    expect(getChatroomSwitcherKeywords(chatroom)).toEqual(['Project Alpha']);
  });

  it('falls back to team name when chatroom has no name', () => {
    const chatroom = makeChatroom({ _id: 'c1', name: undefined, teamName: 'Acme' });
    expect(getChatroomSwitcherKeywords(chatroom)).toEqual(['Acme']);
  });
});

describe('filterChatroomsForSearch', () => {
  it('returns all chatrooms when search is empty', () => {
    const chatrooms = [
      makeChatroom({ _id: 'c1', name: 'Alpha' }),
      makeChatroom({ _id: 'c2', name: 'Beta' }),
    ];
    expect(filterChatroomsForSearch(chatrooms, '')).toHaveLength(2);
  });

  it('filters out non-matching chatrooms', () => {
    const chatrooms = [
      makeChatroom({ _id: 'c1', name: 'Alpha' }),
      makeChatroom({ _id: 'c2', name: 'Beta' }),
    ];
    expect(filterChatroomsForSearch(chatrooms, 'zzz')).toHaveLength(0);
  });

  it('ranks matches by score descending', () => {
    const chatrooms = [
      makeChatroom({ _id: 'c1', name: 'Alpha' }),
      makeChatroom({ _id: 'c2', name: 'Alpha Project' }),
    ];
    const result = filterChatroomsForSearch(chatrooms, 'alpha');
    expect(result.map((c) => c._id)).toEqual(['c1', 'c2']);
  });
});

describe('buildChatroomSwitcherRows', () => {
  it('adds a Chatrooms heading in browse mode', () => {
    const chatrooms = [makeChatroom({ _id: 'c1', name: 'Alpha' })];
    const rows = buildChatroomSwitcherRows(chatrooms, '');
    expect(rows[0]).toEqual({ type: 'heading', id: 'chatrooms', label: 'Chatrooms' });
    expect(rows[1]).toEqual({ type: 'item', id: 'c1', chatroom: chatrooms[0] });
  });

  it('hides the heading and returns ranked items in search mode', () => {
    const chatrooms = [
      makeChatroom({ _id: 'c1', name: 'Alpha' }),
      makeChatroom({ _id: 'c2', name: 'Alpha Project' }),
    ];
    const rows = buildChatroomSwitcherRows(chatrooms, 'alpha');
    expect(rows.every((row) => row.type === 'item')).toBe(true);
    expect(rows.map((row) => row.id)).toEqual(['c1', 'c2']);
  });

  it('returns no heading when search yields no matches', () => {
    const chatrooms = [makeChatroom({ _id: 'c1', name: 'Alpha' })];
    const rows = buildChatroomSwitcherRows(chatrooms, 'zzz');
    expect(rows).toHaveLength(0);
  });
});
