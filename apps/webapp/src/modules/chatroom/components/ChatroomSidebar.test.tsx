import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatroomSidebar } from './ChatroomSidebar';

// Import the mocked hook (must be after vi.mock)
import { useChatroomListing } from '../context/ChatroomListingContext';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockUpdateStatus = vi.fn().mockResolvedValue(undefined);
const mockSendCommand = vi.fn().mockResolvedValue(undefined);
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (mutationRef: unknown) => {
    const ref = mutationRef as { name?: string };
    if (ref && typeof ref === 'object' && 'name' in ref) {
      const name = (ref as { name: string }).name;
      if (name === 'updateStatus') {
        return mockUpdateStatus;
      }
      if (name === 'sendCommand') {
        return mockSendCommand;
      }
    }
    return () => {};
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatrooms: {
      updateStatus: { name: 'updateStatus' },
    },
    machines: {
      sendCommand: { name: 'sendCommand' },
    },
  },
}));

vi.mock('../context/ChatroomListingContext', () => ({
  useChatroomListing: vi.fn().mockReturnValue({ chatrooms: [], isLoading: false }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

interface TestChatroom {
  _id: string;
  _creationTime: number;
  status: 'active' | 'completed';
  chatStatus: 'working' | 'active' | 'idle' | 'completed';
  name?: string;
  teamId?: string;
  teamName?: string;
  teamRoles?: string[];
  agents: { isAlive: boolean; machineId: string; role: string }[];
  isFavorite: boolean;
  hasUnread: boolean;
  hasUnreadHandoff: boolean;
  remoteAgentStatus: 'running' | 'stopped' | 'none';
  runningRoles: string[];
  runningAgentConfigs: { machineId: string; role: string }[];
  lastActivityAt?: number;
}

const makeChatroom = (overrides: Partial<TestChatroom> = {}): TestChatroom =>
  ({
    _id: 'chr-1',
    _creationTime: 1_000_000,
    status: 'active',
    chatStatus: 'active',
    name: 'Test Chat',
    teamId: 'team-1',
    teamName: 'Team',
    teamRoles: ['builder'],
    agents: [],
    isFavorite: false,
    hasUnread: false,
    hasUnreadHandoff: false,
    remoteAgentStatus: 'none',
    runningRoles: [],
    runningAgentConfigs: [],
    lastActivityAt: 1_000_000,
    ...overrides,
  }) as TestChatroom;

const makeCompletedChatroom = (): TestChatroom =>
  makeChatroom({
    _id: 'chr-2',
    chatStatus: 'completed',
    status: 'completed',
    name: 'Completed Chat',
  });

const renderSidebar = (chatrooms: TestChatroom[]) => {
  (useChatroomListing as ReturnType<typeof vi.fn>).mockReturnValue({
    chatrooms,
    isLoading: false,
  });
  return render(<ChatroomSidebar activeChatroomId={chatrooms[0]?._id} />);
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ChatroomSidebar', () => {
  beforeEach(() => {
    mockUpdateStatus.mockReset();
    mockUpdateStatus.mockResolvedValue(undefined);
    mockSendCommand.mockReset();
    mockSendCommand.mockResolvedValue(undefined);
    mockPush.mockReset();
    (useChatroomListing as ReturnType<typeof vi.fn>).mockClear();
  });

  it('renders chatroom items in the sidebar', () => {
    const chatroom = makeChatroom();
    renderSidebar([chatroom]);
    expect(screen.getByText('Test Chat')).toBeInTheDocument();
  });

  it('right-click on non-completed item shows context menu with "Archive Chat"', async () => {
    const chatroom = makeChatroom();
    renderSidebar([chatroom]);

    const sidebarItem = screen.getByText('Test Chat').closest('[role="button"]');
    expect(sidebarItem).toBeInTheDocument();

    if (sidebarItem) {
      fireEvent.contextMenu(sidebarItem, { button: 2 });
    }

    await waitFor(() => {
      expect(screen.getByText('Archive Chat')).toBeInTheDocument();
    });
  });

  it('selecting "Archive Chat" calls updateStatus with status completed', async () => {
    const chatroom = makeChatroom();
    renderSidebar([chatroom]);

    const sidebarItem = screen.getByText('Test Chat').closest('[role="button"]');

    if (sidebarItem) {
      fireEvent.contextMenu(sidebarItem, { button: 2 });
    }

    await waitFor(() => {
      expect(screen.getByText('Archive Chat')).toBeInTheDocument();
    });

    const archiveMenuItem = screen.getByText('Archive Chat');
    fireEvent.click(archiveMenuItem);

    await waitFor(() => {
      expect(mockUpdateStatus).toHaveBeenCalledWith({
        chatroomId: chatroom._id,
        status: 'completed',
      });
    });
  });

  it('completed chatroom items do NOT show context menu archive option', async () => {
    const completedChatroom = makeCompletedChatroom();
    renderSidebar([completedChatroom]);

    // Expand the completed section to reveal the completed chatroom
    const expandButton = screen.getByText(/Completed/);
    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(screen.getByText('Completed Chat')).toBeInTheDocument();
    });

    const sidebarItem = screen.getByText('Completed Chat').closest('[role="button"]');

    if (sidebarItem) {
      fireEvent.contextMenu(sidebarItem, { button: 2 });
    }

    await waitFor(() => {
      expect(screen.queryByText('Archive Chat')).not.toBeInTheDocument();
    });
  });

  it('context menu does not appear for completed chatrooms in completed section', async () => {
    const activeChatroom = makeChatroom();
    const completedChatroom = makeCompletedChatroom();
    renderSidebar([activeChatroom, completedChatroom]);

    // Expand the completed section first
    const expandButton = screen.getByText(/Completed/);
    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(screen.getByText('Completed Chat')).toBeInTheDocument();
    });

    const completedItem = screen.getByText('Completed Chat').closest('[role="button"]');
    if (completedItem) {
      fireEvent.contextMenu(completedItem, { button: 2 });
    }

    await waitFor(() => {
      expect(screen.queryByText('Archive Chat')).not.toBeInTheDocument();
    });
  });
});
