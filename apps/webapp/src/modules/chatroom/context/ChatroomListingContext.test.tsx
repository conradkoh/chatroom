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
      listActiveEnhancerWork: { name: 'chatrooms:listActiveEnhancerWork' },
      getPresenceForChatroom: { name: 'chatrooms:getPresenceForChatroom' },
    },
    machines: {
      listAgentOverview: { name: 'machines:listAgentOverview' },
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

vi.mock('../hooks/usePresenceForChatrooms', () => ({
  usePresenceForChatrooms: () => presenceMock,
}));

const sessionQueryMocks: Record<string, unknown> = {};
let presenceMock: unknown[] = [];

// ── Consumer ──────────────────────────────────────────────────────────────────

function ListingProbe() {
  const { chatrooms } = useChatroomListing();
  if (!chatrooms) return <div data-testid="loading">loading</div>;
  return (
    <ul>
      {chatrooms.map((c) => (
        <li key={c._id} data-testid="room">
          {c._id}:{c.chatStatus}:
          {c.agents.map((a) => `${a.role}:${a.isAlive ? 'alive' : 'dead'}`).join(',')}
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
    presenceMock = [];
    sessionQueryMocks['chatrooms:listByUser'] = baseChatrooms();
    sessionQueryMocks['chatrooms:listFavoriteIds'] = [];
    sessionQueryMocks['chatrooms:listUnreadStatus'] = [];
    sessionQueryMocks['chatrooms:listActiveEnhancerWork'] = [];
    sessionQueryMocks['machines:listAgentOverview'] = [];
  });

  it('shows working chatStatus when a spawned agent has task.inProgress but daemon is disconnected (empty runningRoles)', () => {
    // Agent is spawned (alive via aliveRoles) but its daemon is disconnected, so
    // runningRoles is empty. Presence carries the task.inProgress working signal.
    presenceMock = [
      {
        chatroomId: CHATROOM_ID,
        role: 'builder',
        lastSeenAt: 100,
        lastSeenAction: null,
        lastStatus: 'task.inProgress',
        lastDesiredState: 'running',
      },
    ];
    sessionQueryMocks['machines:listAgentOverview'] = [
      {
        chatroomId: CHATROOM_ID,
        agentStatus: 'stopped',
        runningRoles: [],
        aliveRoles: ['builder'],
        runningAgents: [],
      },
    ];

    render(
      <ChatroomListingProvider>
        <ListingProbe />
      </ChatroomListingProvider>
    );

    const room = screen.getByTestId('room');
    expect(room.textContent).toBe(`${CHATROOM_ID}:working:planner:dead,builder:alive`);
  });

  it('shows idle when no agent is alive', () => {
    sessionQueryMocks['machines:listAgentOverview'] = [
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
    expect(room.textContent).toBe(`${CHATROOM_ID}:idle:planner:dead,builder:dead`);
  });

  it('shows working when both aliveRoles and runningRoles agree the agent is running', () => {
    presenceMock = [
      {
        chatroomId: CHATROOM_ID,
        role: 'builder',
        lastSeenAt: 100,
        lastSeenAction: null,
        lastStatus: 'task.inProgress',
        lastDesiredState: 'running',
      },
    ];
    sessionQueryMocks['machines:listAgentOverview'] = [
      {
        chatroomId: CHATROOM_ID,
        agentStatus: 'running',
        runningRoles: ['builder'],
        aliveRoles: ['builder'],
        runningAgents: [{ role: 'builder', machineId: 'machine-1' }],
      },
    ];

    render(
      <ChatroomListingProvider>
        <ListingProbe />
      </ChatroomListingProvider>
    );

    const room = screen.getByTestId('room');
    expect(room.textContent).toBe(`${CHATROOM_ID}:working:planner:dead,builder:alive`);
  });
});
