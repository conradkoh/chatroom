import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatroomSidebar } from './ChatroomSidebar';
import { useChatroomListing } from '../context/ChatroomListingContext';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockUpdateStatus = vi.fn().mockResolvedValue(undefined);
const mockSendCommand = vi.fn().mockResolvedValue(undefined);
const mockRestartOfflineAgents = vi.fn().mockResolvedValue({ restartedRoles: ['builder'] });
const mockMarkAsUnread = vi.fn().mockResolvedValue(undefined);
const mockToastSuccess = vi.fn();
const mockPush = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

vi.mock('./AgentPanel/UnifiedAgentListModal', () => ({
  UnifiedAgentListModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="start-agent-modal">Start Agent Modal</div> : null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (mutationRef: unknown) => {
    const ref = mutationRef as { name?: string };
    if (ref && typeof ref === 'object' && 'name' in ref) {
      const name = (ref as { name: string }).name;
      if (name === 'markAsUnread') {
        return mockMarkAsUnread;
      }
      if (name === 'updateStatus') {
        return mockUpdateStatus;
      }
      if (name === 'sendCommand') {
        return mockSendCommand;
      }
      if (name === 'restartOfflineAgentsFromConfig') {
        return mockRestartOfflineAgents;
      }
    }
    return () => {};
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatrooms: {
      updateStatus: { name: 'updateStatus' },
      markAsUnread: { name: 'markAsUnread' },
    },
    machines: {
      sendCommand: { name: 'sendCommand' },
      restartOfflineAgentsFromConfig: { name: 'restartOfflineAgentsFromConfig' },
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
  chatStatus: 'working' | 'active' | 'transitioning' | 'idle' | 'completed';
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
    mockRestartOfflineAgents.mockReset();
    mockRestartOfflineAgents.mockResolvedValue({ restartedRoles: ['builder'] });
    mockToastSuccess.mockReset();
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

  it('shows "Mark as Unread" in context menu for active chatrooms', async () => {
    const chatroom = makeChatroom();
    renderSidebar([chatroom]);

    const sidebarItem = screen.getByText('Test Chat').closest('[role="button"]');
    expect(sidebarItem).toBeInTheDocument();

    if (sidebarItem) {
      fireEvent.contextMenu(sidebarItem, { button: 2 });
    }

    await waitFor(() => {
      expect(screen.getByText('Mark as Unread')).toBeInTheDocument();
    });
  });

  it('selecting "Mark as Unread" calls markAsUnread with chatroomId', async () => {
    const chatroom = makeChatroom();
    renderSidebar([chatroom]);

    const sidebarItem = screen.getByText('Test Chat').closest('[role="button"]');
    if (sidebarItem) {
      fireEvent.contextMenu(sidebarItem, { button: 2 });
    }

    await waitFor(() => {
      expect(screen.getByText('Mark as Unread')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Mark as Unread'));

    await waitFor(() => {
      expect(mockMarkAsUnread).toHaveBeenCalledWith({
        chatroomId: chatroom._id,
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

  it('groups idle chatrooms into Last Day, Last Week, Last Month, and Older sections', () => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const startOfYesterday = new Date(now);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);

    renderSidebar([
      makeChatroom({
        _id: 'day',
        name: 'Day Chat',
        chatStatus: 'idle',
        lastActivityAt: startOfYesterday.getTime() + 60_000,
      }),
      makeChatroom({
        _id: 'week',
        name: 'Week Chat',
        chatStatus: 'idle',
        lastActivityAt: now - 2 * dayMs,
      }),
      makeChatroom({
        _id: 'month',
        name: 'Month Chat',
        chatStatus: 'idle',
        lastActivityAt: now - 10 * dayMs,
      }),
      makeChatroom({
        _id: 'older',
        name: 'Older Chat',
        chatStatus: 'idle',
        lastActivityAt: now - 40 * dayMs,
      }),
    ]);

    expect(screen.getByText('Last Day')).toBeInTheDocument();
    expect(screen.getByText('Last Week')).toBeInTheDocument();
    expect(screen.getByText('Last Month')).toBeInTheDocument();
    expect(screen.getByText('Older')).toBeInTheDocument();
    expect(screen.getByText('Day Chat')).toBeInTheDocument();
    expect(screen.getByText('Week Chat')).toBeInTheDocument();
    expect(screen.getByText('Month Chat')).toBeInTheDocument();
    expect(screen.getByText('Older Chat')).toBeInTheDocument();
    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
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

  it('play button restarts offline agents from config without opening modal', async () => {
    const chatroom = makeChatroom({ remoteAgentStatus: 'stopped' });
    renderSidebar([chatroom]);

    const playButton = screen.getByTitle('Start with last configuration');
    fireEvent.click(playButton);

    await waitFor(() => {
      expect(mockRestartOfflineAgents).toHaveBeenCalledWith({
        chatroomId: chatroom._id,
      });
    });

    expect(mockToastSuccess).toHaveBeenCalledWith('Started builder');
    expect(screen.queryByTestId('start-agent-modal')).not.toBeInTheDocument();
  });

  it('play button opens agent modal when no roles are restarted', async () => {
    mockRestartOfflineAgents.mockResolvedValue({ restartedRoles: [] });
    const chatroom = makeChatroom({ remoteAgentStatus: 'none' });
    renderSidebar([chatroom]);

    fireEvent.click(screen.getByTitle('Start with last configuration'));

    await waitFor(() => {
      expect(mockRestartOfflineAgents).toHaveBeenCalledWith({
        chatroomId: chatroom._id,
      });
    });

    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId('start-agent-modal')).toBeInTheDocument();
  });

  it('play button opens agent modal when restart mutation fails', async () => {
    mockRestartOfflineAgents.mockRejectedValue(new Error('restart failed'));
    const chatroom = makeChatroom({ remoteAgentStatus: 'stopped' });
    renderSidebar([chatroom]);

    fireEvent.click(screen.getByTitle('Start with last configuration'));

    await waitFor(() => {
      expect(screen.getByTestId('start-agent-modal')).toBeInTheDocument();
    });

    expect(mockToastSuccess).not.toHaveBeenCalled();
  });
});
