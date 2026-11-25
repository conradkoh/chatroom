import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ChatroomActivityStatus } from '@workspace/shared/domain/chatroom-activity-status';
import {
  deriveChatroomState,
  isChatroomStopAvailable,
} from '@workspace/shared/domain/chatroom-activity-status';
import type * as ConvexReact from 'convex/react';
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
const mockPush = vi.fn();
const mockSaveConfig = vi.fn();
// Convex boundary for the favourites check. `useQueries` answers by query name.
const mockQueryData: Record<string, unknown> = {};
let mockQueriesPending = false;

vi.mock('convex/react', async (importOriginal) => ({
  ...(await importOriginal<typeof ConvexReact>()),
  useQueries: (queries: Record<string, { query: { name: string } }>) =>
    Object.fromEntries(
      Object.entries(queries).map(([key, { query }]) => [
        key,
        mockQueriesPending ? undefined : mockQueryData[query.name],
      ])
    ),
}));

vi.mock('../hooks/useChatroomAgentOperations', () => ({
  useChatroomAgentOperations: () => ({
    startAgents: mockRequestChatroomStart,
    stopAgents: mockRequestChatroomStop,
    restartAgents: mockRequestChatroomRestart,
  }),
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
  useSessionId: () => ['session-1', () => {}],
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
      if (name === 'saveConfig') {
        return mockSaveConfig;
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
      getTeamStructureForChatroom: { name: 'getTeamStructureForChatroom' },
    },
    workspaces: {
      listWorkspacesForChatroom: { name: 'listWorkspacesForChatroom' },
    },
    machines: {
      sendCommand: { name: 'sendCommand' },
      getMachineCapabilities: { name: 'getMachineCapabilities' },
    },
    commands: {
      stopAllCommandRunsForChatroom: { name: 'stopAllCommandRunsForChatroom' },
    },
    machineConfigFavorites: {
      getMachineConfigFavorites: { name: 'getMachineConfigFavorites' },
    },
    agents: {
      requestChatroomAgentOperation: { name: 'requestChatroomAgentOperation' },
      saveConfig: { name: 'saveConfig' },
      listStatus: { name: 'listStatus' },
      listLastSentLaunchRequests: { name: 'listLastSentLaunchRequests' },
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

const renderSidebar = (chatrooms: ChatroomWithStatus[], activeChatroomId = chatrooms[0]?._id) => {
  (useChatroomListing as ReturnType<typeof vi.fn>).mockReturnValue({
    chatrooms,
    isLoading: false,
  });
  return render(<ChatroomSidebar activeChatroomId={activeChatroomId} />);
};

const CURRENT = { agentHarness: 'opencode-sdk', model: 'claude-opus-4-8[effort=high]' };
const FAVOURITE = { agentHarness: 'pi-sdk', model: 'gpt-5.6-terra[reasoning=high]' };

function setStartCheckData(favourites: unknown[]) {
  mockQueryData.getTeamStructureForChatroom = {
    teamId: 'team-1',
    roles: [{ role: 'builder' }, { role: 'user' }],
  };
  mockQueryData.listWorkspacesForChatroom = [
    {
      _id: 'ws-1',
      machineId: 'machine-1',
      workingDir: '/repo',
      hostname: 'host-1',
      machineAlias: 'laptop',
    },
  ];
  mockQueryData.listStatus = [];
  mockQueryData.listLastSentLaunchRequests = [{ role: 'builder', ...CURRENT, workingDir: '/repo' }];
  mockQueryData.getMachineCapabilities = { availableHarnesses: ['opencode-sdk', 'pi-sdk'] };
  mockQueryData.getMachineConfigFavorites = { favorites: favourites };
}

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
    mockPush.mockReset();
    mockSaveConfig.mockReset();
    mockSaveConfig.mockResolvedValue(undefined);
    mockQueriesPending = false;
    setStartCheckData([]);
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

  it('renders stuck status with the shared red indicator and keeps the Start button', () => {
    const chatroom = makeChatroom({ activityStatus: 'stuck', remoteAgentStatus: 'none' });
    renderSidebar([chatroom]);

    const item = screen.getByText('Test Chat').closest('[role="button"]');
    expect(item?.querySelector('.bg-chatroom-status-error')).toBeInTheDocument();
    expect(item?.querySelector('.bg-chatroom-status-info')).not.toBeInTheDocument();
    expect(screen.getByTitle('Start with last configuration')).toBeInTheDocument();
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

  it('play button starts agents from their saved configuration', async () => {
    const chatroom = makeChatroom({ remoteAgentStatus: 'stopped' });
    renderSidebar([chatroom]);

    const playButton = screen.getByTitle('Start with last configuration');
    fireEvent.click(playButton);

    await waitFor(() => {
      expect(mockRequestChatroomStart).toHaveBeenCalledWith('chr-1');
    });
    await act(async () => {});
    expect(screen.queryByTestId('sidebar-feedback')).not.toBeInTheDocument();
  });

  it('reports a neutral message when no saved agent configuration exists', async () => {
    mockRequestChatroomStart.mockResolvedValueOnce({ requested: [], skipped: [], failed: [] });
    renderSidebar([makeChatroom({ remoteAgentStatus: 'stopped' })]);

    fireEvent.click(screen.getByTitle('Start with last configuration'));

    const box = await screen.findByTestId('sidebar-feedback');
    expect(box).toHaveAttribute('role', 'alert');
    expect(box).toHaveTextContent('No saved agent configuration is available.');
  });

  it('shows a partial start failure under the row with one item per failed agent', async () => {
    mockRequestChatroomStart.mockResolvedValueOnce({
      requested: [{ role: 'planner' }],
      skipped: [],
      failed: [{ role: 'builder', error: 'Machine offline' }],
    });
    renderSidebar([makeChatroom({ remoteAgentStatus: 'stopped' })]);

    fireEvent.click(screen.getByTitle('Start with last configuration'));

    const box = await screen.findByTestId('sidebar-feedback');
    expect(box).toHaveAttribute('role', 'alert');
    expect(within(box).getByText('Failed to start 1 agent(s)')).toBeInTheDocument();
    expect(within(box).getByText('Start requested for 1 agent(s)')).toBeInTheDocument();
    expect(within(box).getByText('builder: Machine offline')).toBeInTheDocument();
  });

  it('keeps the box when the row is clicked, and Dismiss removes it', async () => {
    mockRequestChatroomStart.mockResolvedValueOnce({
      requested: [],
      skipped: [],
      failed: [{ role: 'builder', error: 'Machine offline' }],
    });
    renderSidebar([makeChatroom({ remoteAgentStatus: 'stopped' })]);
    fireEvent.click(screen.getByTitle('Start with last configuration'));
    await screen.findByTestId('sidebar-feedback');

    fireEvent.click(screen.getByRole('button', { name: /test chat/i }));
    expect(screen.getByTestId('sidebar-feedback')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('sidebar-feedback')).not.toBeInTheDocument();
  });

  it('clears the previous box when the next start is attempted', async () => {
    mockRequestChatroomStart.mockResolvedValueOnce({
      requested: [],
      skipped: [],
      failed: [{ role: 'builder', error: 'Machine offline' }],
    });
    renderSidebar([makeChatroom({ remoteAgentStatus: 'stopped' })]);
    fireEvent.click(screen.getByTitle('Start with last configuration'));
    await screen.findByTestId('sidebar-feedback');

    fireEvent.click(screen.getByTitle('Start with last configuration'));
    await act(async () => {});
    expect(screen.queryByTestId('sidebar-feedback')).not.toBeInTheDocument();
  });

  it('keeps restart available for a running chatroom', async () => {
    renderSidebar([makeChatroom({ remoteAgentStatus: 'running' })]);

    fireEvent.click(screen.getByTitle('Restart agents'));

    await waitFor(() => {
      expect(mockRequestChatroomRestart).toHaveBeenCalledWith('chr-1');
    });
  });

  it('shows the play button when the chatroom uses the active team structure', async () => {
    const { teamId: _legacyTeamId, ...chatroomWithoutLegacyTeamId } = makeChatroom({
      remoteAgentStatus: 'stopped',
    });
    renderSidebar([chatroomWithoutLegacyTeamId]);

    const playButton = screen.getByTitle('Start with last configuration');
    fireEvent.click(playButton);

    await waitFor(() => {
      expect(mockRequestChatroomStart).toHaveBeenCalledWith('chr-1');
    });
    await act(async () => {});
    expect(screen.queryByTestId('sidebar-feedback')).not.toBeInTheDocument();
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

  it('a fully successful stop renders no sidebar feedback', async () => {
    renderSidebar([makeChatroom({ remoteAgentStatus: 'running' })]);

    fireEvent.click(screen.getByTitle('Stop agents and command runs'));
    await act(async () => {});

    expect(screen.queryByTestId('sidebar-feedback')).not.toBeInTheDocument();
  });

  it('a fully successful restart renders no sidebar feedback', async () => {
    renderSidebar([makeChatroom({ remoteAgentStatus: 'running' })]);

    fireEvent.click(screen.getByTitle('Restart agents'));
    await act(async () => {});

    expect(screen.queryByTestId('sidebar-feedback')).not.toBeInTheDocument();
  });

  it('a partial restart lists its failed agents under the row', async () => {
    mockRequestChatroomRestart.mockResolvedValueOnce({
      requested: [{ role: 'planner' }],
      skipped: [],
      failed: [{ role: 'builder', error: 'Machine offline' }],
    });
    renderSidebar([makeChatroom({ remoteAgentStatus: 'running' })]);

    fireEvent.click(screen.getByTitle('Restart agents'));

    const box = await screen.findByTestId('sidebar-feedback');
    expect(box).toHaveAttribute('role', 'alert');
    expect(within(box).getByText('Failed to restart 1 agent(s)')).toBeInTheDocument();
    expect(within(box).getByText('builder: Machine offline')).toBeInTheDocument();
  });

  describe('play button with favourites check', () => {
    const clickPlay = () => fireEvent.click(screen.getByLabelText('Start agents'));

    /**
     * Renders the sidebar with the mocked start-check queries pending, starts the flow, reproduces the browser's
     * focus loss from a disabled control, then resolves the queries and re-renders.
     *
     * The re-render changes `activeChatroomId` (ChatroomSidebar is memoised) and `canStop` (so the memoised
     * `ChatroomSidebarAgentActions` re-runs `useQueries`); identical props would bail out and the mocked
     * queries would never re-run.
     */
    const renderWithDeferredCheck = () => {
      mockQueriesPending = true;
      setStartCheckData([FAVOURITE]);
      const chatroom = makeChatroom({ remoteAgentStatus: 'stopped' });
      const { rerender } = renderSidebar([chatroom]);
      const play = screen.getByLabelText('Start agents');
      play.focus();
      clickPlay();
      expect(play).toBeDisabled();
      // Browsers move focus to <body> when the focused control becomes disabled; jsdom keeps focus and refuses
      // to blur a disabled control, so move focus to the body explicitly. The popup records <body> as the
      // element focused before open, which is why returning to the play button needs an explicit finalFocus.
      act(() => {
        document.body.setAttribute('tabindex', '-1');
        document.body.focus();
        document.body.removeAttribute('tabindex');
      });
      expect(play).not.toHaveFocus();
      mockQueriesPending = false;
      // Both ChatroomSidebar and ChatroomSidebarAgentActions are memoised, so resolving the mocked queries needs
      // a re-render with a changed prop that reaches the actions. Flip `canStop` while keeping the activity
      // status (and so the row's section) unchanged; the Start button keeps the same element and ref.
      mockStatuses.set(chatroom._id, {
        ...makeStatus(chatroom._id, 'active', 'stopped'),
        canStop: false,
      });
      (useChatroomListing as ReturnType<typeof vi.fn>).mockReturnValue({
        chatrooms: [chatroom],
        isLoading: false,
      });
      rerender(<ChatroomSidebar activeChatroomId="chr-other" />);
    };

    it('starts immediately with no dialog when every agent is on its top favourite', async () => {
      setStartCheckData([CURRENT]);
      renderSidebar([makeChatroom({ remoteAgentStatus: 'stopped' })]);
      clickPlay();
      await waitFor(() => expect(mockRequestChatroomStart).toHaveBeenCalledWith('chr-1'));
      expect(screen.queryByTestId('start-favourites-dialog')).not.toBeInTheDocument();
      expect(mockSaveConfig).not.toHaveBeenCalled();
      await act(async () => {});
      expect(screen.queryByTestId('sidebar-feedback')).not.toBeInTheDocument();
    });

    it('opens the dialog listing current → favourite and starts nothing until the user chooses', async () => {
      setStartCheckData([FAVOURITE]);
      renderSidebar([makeChatroom({ remoteAgentStatus: 'stopped' })]);
      clickPlay();
      const dialog = await screen.findByTestId('start-favourites-dialog');
      const rows = within(dialog).getAllByTestId('start-favourites-row');
      expect(rows).toHaveLength(1);
      expect(
        within(rows[0]).getByText('opencode-sdk · Claude Opus 4.8 [high]')
      ).toBeInTheDocument();
      expect(within(rows[0]).getByText('pi-sdk · Gpt 5.6 Terra [high]')).toBeInTheDocument();
      expect(mockRequestChatroomStart).not.toHaveBeenCalled();
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    it('Start with current starts without saving', async () => {
      setStartCheckData([FAVOURITE]);
      renderSidebar([makeChatroom({ remoteAgentStatus: 'stopped' })]);
      clickPlay();
      fireEvent.click(await screen.findByTestId('start-favourites-current'));
      await waitFor(() => expect(mockRequestChatroomStart).toHaveBeenCalledWith('chr-1'));
      expect(mockSaveConfig).not.toHaveBeenCalled();
      await act(async () => {});
      expect(screen.queryByTestId('sidebar-feedback')).not.toBeInTheDocument();
    });

    it('Use favourites & start saves the favourite before starting and reports it', async () => {
      setStartCheckData([FAVOURITE]);
      renderSidebar([makeChatroom({ remoteAgentStatus: 'stopped' })]);
      clickPlay();
      fireEvent.click(await screen.findByTestId('start-favourites-use'));
      await waitFor(() => expect(mockRequestChatroomStart).toHaveBeenCalledWith('chr-1'));
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          chatroomId: 'chr-1',
          workspaceId: 'ws-1',
          role: 'builder',
          machineId: 'machine-1',
          workingDir: '/repo',
          agentHarness: 'pi-sdk',
          model: 'gpt-5.6-terra[reasoning=high]',
        })
      );
      expect(mockSaveConfig.mock.invocationCallOrder[0]).toBeLessThan(
        mockRequestChatroomStart.mock.invocationCallOrder[0]
      );
      await act(async () => {});
      expect(screen.queryByTestId('sidebar-feedback')).not.toBeInTheDocument();
    });

    it('Cancel starts and saves nothing', async () => {
      setStartCheckData([FAVOURITE]);
      renderSidebar([makeChatroom({ remoteAgentStatus: 'stopped' })]);
      clickPlay();
      fireEvent.click(await screen.findByTestId('start-favourites-cancel'));
      await waitFor(() =>
        expect(screen.queryByTestId('start-favourites-dialog')).not.toBeInTheDocument()
      );
      expect(mockRequestChatroomStart).not.toHaveBeenCalled();
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    it('clicks, keys and context menus inside the dialog do not select the chatroom row or open its menu', async () => {
      setStartCheckData([FAVOURITE]);
      // Render the row inactive: selection is a no-op for the active chatroom, so it could not observe propagation.
      renderSidebar([makeChatroom({ remoteAgentStatus: 'stopped' })], 'chr-other');
      clickPlay();
      const row = await screen.findByTestId('start-favourites-row');
      fireEvent.click(row);
      fireEvent.keyDown(row, { key: 'Enter' });
      fireEvent.contextMenu(row);
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockRequestChatroomStart).not.toHaveBeenCalled();
      expect(screen.queryByText('Archive Chat')).not.toBeInTheDocument();
    });

    it('play button is disabled with aria-busy and a checking title while the check runs', () => {
      mockQueriesPending = true;
      setStartCheckData([FAVOURITE]);
      renderSidebar([makeChatroom({ remoteAgentStatus: 'stopped' })]);
      clickPlay();
      const button = screen.getByTitle('Checking favourite models…');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(mockRequestChatroomStart).not.toHaveBeenCalled();
    });

    it('returns focus to the play button after Cancel', async () => {
      renderWithDeferredCheck();
      fireEvent.click(await screen.findByTestId('start-favourites-cancel'));
      await waitFor(() => expect(screen.getByLabelText('Start agents')).toHaveFocus());
    });

    it('returns focus to the play button after Start with current', async () => {
      renderWithDeferredCheck();
      fireEvent.click(await screen.findByTestId('start-favourites-current'));
      await waitFor(() => expect(mockRequestChatroomStart).toHaveBeenCalledWith('chr-1'));
      await waitFor(() => expect(screen.getByLabelText('Start agents')).toHaveFocus());
    });
  });
});
