import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatroomCard } from './ChatroomCard';
import type { ChatroomWithStatus } from '../../context/ChatroomListingContext';

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
  useSessionMutation: () => vi.fn(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatrooms: { toggleFavorite: { name: 'toggleFavorite' } },
  },
}));

const mockStatuses = new Map<string, { state: 'active' | 'completed' }>();

vi.mock('../../hooks/useChatroomStatus', () => ({
  useChatroomStatus: (chatroomId: string) => ({ status: mockStatuses.get(chatroomId) }),
}));

vi.mock('../LifecycleConfirmDialog', () => ({
  LifecycleConfirmDialog: () => null,
}));

function makeChatroom(overrides: Partial<ChatroomWithStatus> = {}): ChatroomWithStatus {
  return {
    _id: 'chr-1',
    _creationTime: 1,
    status: 'active',
    name: 'Alpha',
    teamId: 'team-1',
    teamName: 'Team',
    teamRoles: ['builder'],
    isFavorite: false,
    hasUnread: false,
    hasUnreadHandoff: false,
    ...overrides,
  };
}

function renderCard(chatroom: ChatroomWithStatus) {
  const onSelect = vi.fn();
  render(
    <ChatroomCard
      chatroom={chatroom}
      onSelect={onSelect}
      activeTab={chatroom.status === 'completed' ? 'complete' : 'current'}
    />
  );
  return { onSelect };
}

async function openMenu() {
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: 'Chatroom actions' });
  await user.click(trigger);
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
  return user;
}

describe('ChatroomCard actions', () => {
  beforeEach(() => {
    mockStatuses.clear();
  });

  it('shows Archive Chat in the actions menu for an active chatroom and no export item', async () => {
    mockStatuses.set('chr-1', { state: 'active' });
    renderCard(makeChatroom());
    await openMenu();

    expect(screen.getByText('Archive Chat')).toBeInTheDocument();
    expect(screen.queryByTestId('chatroom-action-export')).not.toBeInTheDocument();
  });

  it('renders no actions trigger for a completed chatroom', () => {
    mockStatuses.set('chr-1', { state: 'completed' });
    renderCard(makeChatroom({ status: 'completed', name: 'Done room' }));

    expect(screen.queryByRole('button', { name: 'Chatroom actions' })).not.toBeInTheDocument();
  });

  it('opening Archive does not select the card', async () => {
    mockStatuses.set('chr-1', { state: 'active' });
    const { onSelect } = renderCard(makeChatroom());
    const user = await openMenu();

    await user.click(screen.getByText('Archive Chat'));

    expect(onSelect).not.toHaveBeenCalled();
  });
});
