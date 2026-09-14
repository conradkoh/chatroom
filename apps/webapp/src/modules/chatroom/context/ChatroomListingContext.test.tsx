import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatroomListingProvider, useChatroomListing } from './ChatroomListingContext';

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatrooms: {
      listByUser: { name: 'chatrooms:listByUser' },
      listFavoriteIds: { name: 'chatrooms:listFavoriteIds' },
      listUnreadStatus: { name: 'chatrooms:listUnreadStatus' },
    },
  },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (queryRef: unknown) => {
    const name = (queryRef as { name?: string })?.name ?? '';
    return sessionQueryMocks[name];
  },
}));

const sessionQueryMocks: Record<string, unknown> = {};
const CHATROOM_ID = 'chr_test_1234567890';

function ListingProbe() {
  const { chatrooms } = useChatroomListing();
  if (!chatrooms) return <div data-testid="loading">loading</div>;
  return (
    <ul>
      {chatrooms.map((chatroom) => (
        <li key={chatroom._id} data-testid="room">
          {chatroom._id}:{chatroom.name}:{chatroom.isFavorite ? 'favorite' : 'not-favorite'}
        </li>
      ))}
    </ul>
  );
}

function baseChatrooms() {
  return [
    {
      _id: CHATROOM_ID,
      _creationTime: 0,
      status: 'active' as const,
      name: 'Test Chat',
      teamId: 'duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
      lastActivityAt: 0,
    },
  ];
}

describe('ChatroomListingProvider', () => {
  beforeEach(() => {
    sessionQueryMocks['chatrooms:listByUser'] = baseChatrooms();
    sessionQueryMocks['chatrooms:listFavoriteIds'] = [CHATROOM_ID];
    sessionQueryMocks['chatrooms:listUnreadStatus'] = [
      { chatroomId: CHATROOM_ID, hasUnread: true, hasUnreadHandoff: false },
    ];
  });

  it('merges base listing, favorite, and unread data without status subscriptions', () => {
    render(
      <ChatroomListingProvider>
        <ListingProbe />
      </ChatroomListingProvider>
    );

    expect(screen.getByTestId('room').textContent).toBe(`${CHATROOM_ID}:Test Chat:favorite`);
  });
});
