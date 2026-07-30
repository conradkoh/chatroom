import { describe, expect, it } from 'vitest';

import { selectChatroomChatStatus, type ChatroomWithStatus } from './ChatroomListingContext';

function room(id: string, chatStatus: ChatroomWithStatus['chatStatus']): ChatroomWithStatus {
  return {
    _id: id,
    _creationTime: 0,
    status: 'active',
    agents: [],
    chatStatus,
    isFavorite: false,
    hasUnread: false,
    hasUnreadHandoff: false,
    remoteAgentStatus: 'none',
    runningRoles: [],
    runningAgentConfigs: [],
  };
}

describe('selectChatroomChatStatus', () => {
  it('returns chatStatus for matching chatroom', () => {
    const chatrooms = [room('a', 'working'), room('b', 'active')];
    expect(selectChatroomChatStatus(chatrooms, 'a')).toBe('working');
    expect(selectChatroomChatStatus(chatrooms, 'b')).toBe('active');
  });

  it('returns idle when chatrooms undefined (still loading)', () => {
    expect(selectChatroomChatStatus(undefined, 'a')).toBe('idle');
  });

  it('returns idle when chatroom not found', () => {
    expect(selectChatroomChatStatus([room('a', 'working')], 'missing')).toBe('idle');
  });
});
