import { webcrypto } from 'node:crypto';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TabType } from './chatroomSelectorModel';
import { ChatroomTable } from './ChatroomTable';
import type { ChatroomWithStatus } from '../../context/ChatroomListingContext';

import type { ChatroomStatus } from '@/domain/entities/chatroom-status';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: mocks.query }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
  useSessionMutation: () => vi.fn(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatrooms: { toggleFavorite: { name: 'toggleFavorite' } },
    chatroomExport: {
      getStamp: { name: 'getStamp' },
      readPage: { name: 'readPage' },
      listForMachine: { name: 'listForMachine' },
    },
  },
}));

vi.mock('../LifecycleConfirmDialog', () => ({
  LifecycleConfirmDialog: () => null,
}));

const STAMP = {
  lastActivityAt: null,
  nextQueuePosition: null,
  latestMessage: null,
  taskCounts: null,
  latest: {},
  attachmentRows: { count: 0, capped: false, totalBytes: 0 },
};

const ROOM_ROW = {
  id: 'room-1',
  creationTime: 1,
  fields: { status: 'active', name: 'Alpha', teamStructureId: 'team-1' },
};

function page(rows: (typeof ROOM_ROW)[]) {
  return { rows, continueCursor: null, isDone: true };
}

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
  await user.click(screen.getByRole('button', { name: 'Chatroom actions' }));
  await screen.findByTestId('chatroom-action-export');
  return user;
}

describe('ChatroomTable export', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
    mocks.query.mockReset();
    mocks.query.mockImplementation(async (ref: { name?: string }, args: { category?: string }) => {
      if (ref.name === 'getStamp') return STAMP;
      if (ref.name === 'readPage') {
        return page(args.category === 'room' ? [ROOM_ROW] : []);
      }
      throw new Error(`Unexpected query: ${ref.name}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows Export and Archive for an active chatroom', async () => {
    renderTable(makeChatroom());
    await openMenu();

    expect(screen.getByTestId('chatroom-action-export')).toHaveTextContent('Export chatroom');
    expect(screen.getByText('Archive Chat')).toBeInTheDocument();
  });

  it('shows Export but not Archive for a completed chatroom', async () => {
    renderTable(makeChatroom({ status: 'completed', name: 'Done room' }), 'complete');
    await openMenu();

    expect(screen.getByTestId('chatroom-action-export')).toHaveTextContent('Export chatroom');
    expect(screen.queryByText('Archive Chat')).not.toBeInTheDocument();
  });

  it('renders a feedback row only after an export starts', async () => {
    renderTable(makeChatroom());
    expect(screen.queryByTestId('chatroom-export-feedback')).not.toBeInTheDocument();

    const user = await openMenu();
    await user.click(screen.getByTestId('chatroom-action-export'));

    const success = await screen.findByText(/Exported “Alpha” to chatroom-chr-1-.*\.json\./);
    expect(screen.getByTestId('chatroom-export-feedback')).toContainElement(success);
  });

  it('does not select the row from the action menu', async () => {
    const { onSelect } = renderTable(makeChatroom());
    const user = await openMenu();

    await user.click(screen.getByTestId('chatroom-action-export'));

    await screen.findByText(/Exported “Alpha”/);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a retryable failure in the feedback row', async () => {
    mocks.query.mockRejectedValueOnce({
      data: { code: 'EXPORT_CHATROOM_CHANGED', message: 'changed' },
    });
    renderTable(makeChatroom());
    const user = await openMenu();

    await user.click(screen.getByTestId('chatroom-action-export'));

    expect(await screen.findByText('Export failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
