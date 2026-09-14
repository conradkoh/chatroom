import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ChatroomActivityStatus } from '@workspace/shared/domain/chatroom-activity-status';
import {
  deriveChatroomState,
  isChatroomStopAvailable,
} from '@workspace/shared/domain/chatroom-activity-status';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatroomSidebar } from './ChatroomSidebar';
import type { ChatroomWithStatus } from '../context/ChatroomListingContext';
import { useChatroomListing } from '../context/ChatroomListingContext';

import type { ChatroomRemoteAgentStatus, ChatroomStatus } from '@/domain/entities/chatroom-status';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockArchiveChatroom = vi.fn().mockResolvedValue({ success: true, disabledPromptCount: 0 });
const mockRequestChatroomStop = vi.fn().mockResolvedValue({ stopCommandId: 'stop' });
const mockRequestChatroomStart = vi
  .fn()
  .mockResolvedValue({ requested: [{ role: 'planner' }], skipped: [], failed: [] });
const mockRequestChatroomRestart = vi
  .fn()
  .mockResolvedValue({ requested: [{ role: 'planner' }], skipped: [], failed: [] });
const mockStopAllCommandRuns = vi.fn().mockResolvedValue({ stoppedCount: 0 });
const mockMarkAsUnread = vi.fn().mockResolvedValue(undefined);
const mockMarkAsRead = vi.fn().mockResolvedValue(undefined);
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockPush = vi.fn();

vi.mock('../hooks/useChatroomAgentOperations', () => ({
  useChatroomAgentOperations: () => ({
    startAgents: mockRequestChatroomStart,
    stopAgents: mockRequestChatroomStop,
    restartAgents: mockRequestChatroomRestart,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock('./LifecycleConfirmDialog', () => ({
  LifecycleConfirmDialog: ({ open, onOpenChange }: any) =>
    open ? (
      <div data-testid="archive-dialog">
        <span>Archive this chat?</span>
        <button onClick={() => onOpenChange(false)}>Cancel</button>
        <button
          onClick={() => {
            // Simulate confirm
            onOpenChange(false);
          }}
        >
          Archive
        </button>
      </div>
    ) : null,
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
      if (name === 'markAsRead') {
        return mockMarkAsRead;
      }
      if (name === 'archive') {
        return mockArchiveChatroom;
      }
      if (name === 'stopAllCommandRunsForChatroom') {
        return mockStopAllCommandRuns;
      }
    }
    return () => {};
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatrooms: {
      archive: { name: 'archive' },
      getLifecycleImpacts: { name: 'getLifecycleImpacts' },
      markAsUnread: { name: 'markAsUnread' },
      markAsRead: { name: 'markAsRead' },
    },
    machines: {
      sendCommand: { name: 'sendCommand' },
    },
    commands: {
      stopAllCommandRunsForChatroom: { name: 'stopAllCommandRunsForChatroom' },
    },
    agents: {
      requestChatroomAgentOperation: { name: 'requestChatroomAgentOperation' },
    },
  },
}));

vi.mock('../context/ChatroomListingContext', () => ({
  useChatroomListing: vi.fn().mockReturnValue({ chatrooms: [], isLoading: false }),
}));

const mockStatuses = new Map<string, ChatroomStatus>();

vi.mock('../hooks/useChatroomStatus', () => ({
  useChatroomStatus: (chatroomId: string) => ({
    status: mockStatuses.get(chatroomId),
    isLoading: !mockStatuses.has(chatroomId),
  }),
  useChatroomStatusMap: () => ({ statuses: mockStatuses, isLoading: false }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

type TestChatroomOverrides = Partial<ChatroomWithStatus> & {
  activityStatus?: ChatroomActivityStatus;
  remoteAgentStatus?: ChatroomRemoteAgentStatus;
};

const makeChatroom = (overrides: TestChatroomOverrides = {}): ChatroomWithStatus => {
  const chatroomId = overrides._id ?? 'chr-1';
  const activityStatus = overrides.activityStatus ?? 'active';
  const remoteAgentStatus = overrides.remoteAgentStatus ?? 'none';
  const {
    activityStatus: _activityStatus,
    remoteAgentStatus: _remoteAgentStatus,
    ...chatroomOverrides
  } = overrides;

  const chatroom: ChatroomWithStatus = {
    _id: chatroomId,
    _creationTime: 1_000_000,
    status: 'active' as const,
    name: 'Test Chat',
    teamId: 'team-1',
    teamName: 'Team',
    teamRoles: ['builder'],
    isFavorite: false,
    hasUnread: false,
    hasUnreadHandoff: false,
    lastActivityAt: 1_000_000,
    ...chatroomOverrides,
  };
  mockStatuses.set(chatroomId, makeStatus(chatroomId, activityStatus, remoteAgentStatus));
  return chatroom;
};

function makeStatus(
  chatroomId: string,
  activityStatus: ChatroomActivityStatus,
  remoteAgentStatus: ChatroomRemoteAgentStatus
): ChatroomStatus {
  return {
    chatroomId,
    activityStatus,
    state: deriveChatroomState(activityStatus),
    remoteAgentStatus,
    canStop: remoteAgentStatus === 'running' || isChatroomStopAvailable(activityStatus),
  };
}

const makeCompletedChatroom = (): ChatroomWithStatus =>
  makeChatroom({
    _id: 'chr-2',
    activityStatus: 'completed',
    status: 'completed',
    name: 'Completed Chat',
  });

const renderSidebar = (chatrooms: ChatroomWithStatus[]) => {
  (useChatroomListing as ReturnType<typeof vi.fn>).mockReturnValue({
    chatrooms,
    isLoading: false,
  });
  return render(<ChatroomSidebar activeChatroomId={chatrooms[0]?._id} />);
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ChatroomSidebar', () => {
  beforeEach(() => {
    mockArchiveChatroom.mockReset();
    mockArchiveChatroom.mockResolvedValue({ success: true, disabledPromptCount: 0 });
    mockRequestChatroomStop.mockReset();
    mockRequestChatroomStop.mockResolvedValue({ stopCommandId: 'stop' });
    mockRequestChatroomStart.mockReset();
    mockRequestChatroomStart.mockResolvedValue({
      requested: [{ role: 'planner' }],
      skipped: [],
      failed: [],
    });
    mockRequestChatroomRestart.mockReset();
    mockRequestChatroomRestart.mockResolvedValue({
      requested: [{ role: 'planner' }],
      skipped: [],
      failed: [],
    });
    mockStopAllCommandRuns.mockReset();
    mockStopAllCommandRuns.mockResolvedValue({ stoppedCount: 0 });
    mockMarkAsUnread.mockReset();
    mockMarkAsRead.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockPush.mockReset();
    mockStatuses.clear();
    (useChatroomListing as ReturnType<typeof vi.fn>).mockClear();
  });

  it('renders chatroom items in the sidebar', () => {
    const chatroom = makeChatroom();
    renderSidebar([chatroom]);
    expect(screen.getByText('Test Chat')).toBeInTheDocument();
  });

  it('renders working status with the shared blue indicator', () => {
    const chatroom = makeChatroom({ activityStatus: 'working' });
    renderSidebar([chatroom]);

    const item = screen.getByText('Test Chat').closest('[role="button"]');
    expect(item?.querySelector('.bg-chatroom-status-info')).toBeInTheDocument();
    expect(item?.querySelector('.bg-chatroom-status-success')).not.toBeInTheDocument();
  });

  it('renders a muted loading indicator before chatroom status resolves', () => {
    const chatroom = makeChatroom();
    mockStatuses.delete(chatroom._id);
    renderSidebar([chatroom]);

    const item = screen.getByText('Test Chat').closest('[role="button"]');
    expect(item?.querySelector('.bg-chatroom-text-muted')).toBeInTheDocument();
  });

  it('renders skeleton loader while chatrooms are loading', () => {
    (useChatroomListing as ReturnType<typeof vi.fn>).mockReturnValue({
      chatrooms: undefined,
      isLoading: true,
    });
    render(<ChatroomSidebar activeChatroomId="chr-1" />);

    expect(screen.getByRole('status', { name: 'Loading chatrooms' })).toBeInTheDocument();
    expect(screen.getByText('Chatrooms')).toBeInTheDocument();
    // No real chatroom items during load
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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

  it('selecting "Archive Chat" opens archive confirmation dialog (does not call mutation directly)', async () => {
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
      expect(screen.getByTestId('archive-dialog')).toBeInTheDocument();
    });

    // Mutation should NOT be called on menu select — only on dialog confirm
    expect(mockArchiveChatroom).not.toHaveBeenCalled();
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
      expect(mockMarkAsRead).not.toHaveBeenCalled();
    });
  });

  it('shows "Mark as Read" when chatroom hasUnread is true', async () => {
    const chatroom = makeChatroom({ hasUnread: true });
    renderSidebar([chatroom]);

    const sidebarItem = screen.getByText('Test Chat').closest('[role="button"]');
    if (sidebarItem) fireEvent.contextMenu(sidebarItem, { button: 2 });

    await waitFor(() => {
      expect(screen.getByText('Mark as Read')).toBeInTheDocument();
      expect(screen.queryByText('Mark as Unread')).not.toBeInTheDocument();
    });
  });

  it('selecting "Mark as Read" calls markAsRead with chatroomId', async () => {
    const chatroom = makeChatroom({ hasUnread: true });
    renderSidebar([chatroom]);

    const sidebarItem = screen.getByText('Test Chat').closest('[role="button"]');
    if (sidebarItem) fireEvent.contextMenu(sidebarItem, { button: 2 });

    await waitFor(() => expect(screen.getByText('Mark as Read')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Mark as Read'));

    await waitFor(() => {
      expect(mockMarkAsRead).toHaveBeenCalledWith({ chatroomId: chatroom._id });
      expect(mockMarkAsUnread).not.toHaveBeenCalled();
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
        activityStatus: 'idle',
        lastActivityAt: startOfYesterday.getTime() + 60_000,
      }),
      makeChatroom({
        _id: 'week',
        name: 'Week Chat',
        activityStatus: 'idle',
        lastActivityAt: now - 2 * dayMs,
      }),
      makeChatroom({
        _id: 'month',
        name: 'Month Chat',
        activityStatus: 'idle',
        lastActivityAt: now - 10 * dayMs,
      }),
      makeChatroom({
        _id: 'older',
        name: 'Older Chat',
        activityStatus: 'idle',
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

  it('play button starts permanent agents from their saved configuration', async () => {
    const chatroom = makeChatroom({ remoteAgentStatus: 'stopped' });
    renderSidebar([chatroom]);

    const playButton = screen.getByTitle('Start with last configuration');
    fireEvent.click(playButton);

    await waitFor(() => {
      expect(mockRequestChatroomStart).toHaveBeenCalledWith('chr-1');
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Start requested for 1 agent(s)');
  });

  it('shows stop for a projected active chatroom even when the daemon summary is stopped', () => {
    renderSidebar([
      makeChatroom({
        activityStatus: 'active',
        remoteAgentStatus: 'stopped',
      }),
    ]);

    expect(screen.getByTitle('Stop agents and command runs')).toBeInTheDocument();
  });

  it('stops agents and command processes from one click', async () => {
    const chatroom = makeChatroom({
      remoteAgentStatus: 'running',
    });
    renderSidebar([chatroom]);

    fireEvent.click(screen.getByTitle('Stop agents and command runs'));

    await waitFor(() => {
      expect(mockRequestChatroomStop).toHaveBeenCalledWith(chatroom._id);
      expect(mockStopAllCommandRuns).toHaveBeenCalledWith({
        chatroomId: chatroom._id,
      });
    });
  });
});
