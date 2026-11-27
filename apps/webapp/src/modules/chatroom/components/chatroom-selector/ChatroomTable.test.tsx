import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { TabType } from './chatroomSelectorModel';
import { ChatroomTable } from './ChatroomTable';
import type { ChatroomWithStatus } from '../../context/ChatroomListingContext';

import type { ChatroomStatus } from '@/domain/entities/chatroom-status';

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
  useSessionMutation: () => vi.fn(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatrooms: { toggleFavorite: { name: 'toggleFavorite' } },
  },
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

function makeStatus(chatroomId: string, state: 'active' | 'completed'): ChatroomStatus {
  return {
    chatroomId,
    activityStatus: state,
    state,
    remoteAgentStatus: 'none',
    canStop: false,
  };
}

function renderTable(
  chatroom: ChatroomWithStatus,
  activeTab: TabType = 'current'
): { onSelect: ReturnType<typeof vi.fn> } {
  const onSelect = vi.fn();
  const state = chatroom.status === 'completed' ? 'completed' : 'active';
  render(
    <ChatroomTable
      chatrooms={[chatroom]}
      statuses={new Map([[chatroom._id, makeStatus(chatroom._id, state)]])}
      onSelect={onSelect}
      activeTab={activeTab}
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

describe('ChatroomTable actions', () => {
  it('shows Archive Chat in the row menu for an active chatroom and no export item', async () => {
    renderTable(makeChatroom());
    await openMenu();

    expect(screen.getByText('Archive Chat')).toBeInTheDocument();
    expect(screen.queryByTestId('chatroom-action-export')).not.toBeInTheDocument();
  });

  it('renders no actions trigger for a completed row', () => {
    renderTable(makeChatroom({ status: 'completed', name: 'Done room' }), 'complete');

    expect(screen.queryByRole('button', { name: 'Chatroom actions' })).not.toBeInTheDocument();
  });

  it('the row menu does not select the row', async () => {
    const { onSelect } = renderTable(makeChatroom());
    const user = await openMenu();

    await user.click(screen.getByText('Archive Chat'));

    expect(onSelect).not.toHaveBeenCalled();
  });
});
