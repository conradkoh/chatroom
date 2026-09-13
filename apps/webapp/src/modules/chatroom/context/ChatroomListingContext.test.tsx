import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatroomListingProvider, useChatroomListing } from './ChatroomListingContext';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatrooms: {
      listByUser: { name: 'chatrooms:listByUser' },
      listFavoriteIds: { name: 'chatrooms:listFavoriteIds' },
      listUnreadStatus: { name: 'chatrooms:listUnreadStatus' },
    },
    agents: {
      listChatroomStatus: { name: 'agents:listChatroomStatus' },
      listStatusForAllChatrooms: { name: 'agents:listStatusForAllChatrooms' },
    },
  },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (queryRef: unknown) => {
    const name = (queryRef as { name?: string })?.name ?? '';
    const mock = vi.mocked(sessionQueryMocks);
    return mock[name] ?? undefined;
  },
  useSessionMutation: () => vi.fn(),
}));

const sessionQueryMocks: Record<string, unknown> = {};

// ── Consumer ──────────────────────────────────────────────────────────────────

function ListingProbe() {
  const { chatrooms } = useChatroomListing();
  if (!chatrooms) return <div data-testid="loading">loading</div>;
  return (
    <ul>
      {chatrooms.map((c) => (
        <li key={c._id} data-testid="room">
          {c._id}:{c.chatroomStatus.activityStatus}
        </li>
      ))}
    </ul>
  );
}

const CHATROOM_ID = 'chr_test_1234567890';

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ChatroomListingProvider agent/status derivation', () => {
  beforeEach(() => {
    sessionQueryMocks['chatrooms:listByUser'] = baseChatrooms();
    sessionQueryMocks['chatrooms:listFavoriteIds'] = [];
    sessionQueryMocks['chatrooms:listUnreadStatus'] = [];
    sessionQueryMocks['agents:listStatusForAllChatrooms'] = [];
    sessionQueryMocks['agents:listChatroomStatus'] = [];
  });

  it('shows working activityStatus from the projected role status', () => {
    sessionQueryMocks['agents:listChatroomStatus'] = [
      {
        chatroomId: CHATROOM_ID,
        agentStatus: 'stopped',
        runningRoles: [],
        aliveRoles: ['builder'],
        runningAgents: [],
      },
    ];
    sessionQueryMocks['agents:listStatusForAllChatrooms'] = [
      {
        chatroomId: CHATROOM_ID,
        role: 'builder',
        roleKind: 'persistent',
        status: 'working',
        projectedAt: 100,
      },
    ];
    render(
      <ChatroomListingProvider>
        <ListingProbe />
      </ChatroomListingProvider>
    );

    const room = screen.getByTestId('room');
    expect(room.textContent).toBe(`${CHATROOM_ID}:working`);
  });

  it('shows idle when no agent is alive', () => {
    sessionQueryMocks['agents:listChatroomStatus'] = [
      {
        chatroomId: CHATROOM_ID,
        agentStatus: 'stopped',
        runningRoles: [],
        aliveRoles: [],
        runningAgents: [],
      },
    ];
    render(
      <ChatroomListingProvider>
        <ListingProbe />
      </ChatroomListingProvider>
    );

    const room = screen.getByTestId('room');
    expect(room.textContent).toBe(`${CHATROOM_ID}:idle`);
  });

  it('shows working when both aliveRoles and runningRoles agree the agent is running', () => {
    sessionQueryMocks['agents:listChatroomStatus'] = [
      {
        chatroomId: CHATROOM_ID,
        agentStatus: 'running',
        runningRoles: ['builder'],
        aliveRoles: ['builder'],
        runningAgents: [{ role: 'builder', machineId: 'machine-1' }],
      },
    ];
    sessionQueryMocks['agents:listStatusForAllChatrooms'] = [
      {
        chatroomId: CHATROOM_ID,
        role: 'builder',
        roleKind: 'persistent',
        status: 'working',
        projectedAt: 100,
      },
    ];

    render(
      <ChatroomListingProvider>
        <ListingProbe />
      </ChatroomListingProvider>
    );

    const room = screen.getByTestId('room');
    expect(room.textContent).toBe(`${CHATROOM_ID}:working`);
  });
});
