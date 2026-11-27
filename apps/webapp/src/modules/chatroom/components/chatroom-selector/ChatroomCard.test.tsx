import { webcrypto } from 'node:crypto';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatroomCard } from './ChatroomCard';
import type { ChatroomWithStatus } from '../../context/ChatroomListingContext';

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

const mockStatuses = new Map<string, { state: 'active' | 'completed' }>();

vi.mock('../../hooks/useChatroomStatus', () => ({
  useChatroomStatus: (chatroomId: string) => ({ status: mockStatuses.get(chatroomId) }),
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
  await user.click(screen.getByRole('button', { name: 'Chatroom actions' }));
  await screen.findByTestId('chatroom-action-export');
  return user;
}

describe('ChatroomCard export', () => {
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
    mockStatuses.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows Export and Archive for an active chatroom', async () => {
    mockStatuses.set('chr-1', { state: 'active' });
    renderCard(makeChatroom());
    await openMenu();

    expect(screen.getByTestId('chatroom-action-export')).toHaveTextContent('Export chatroom');
    expect(screen.getByText('Archive Chat')).toBeInTheDocument();
  });

  it('shows Export but not Archive for a completed chatroom', async () => {
    mockStatuses.set('chr-1', { state: 'completed' });
    renderCard(makeChatroom({ status: 'completed', name: 'Done room' }));
    await openMenu();

    expect(screen.getByTestId('chatroom-action-export')).toHaveTextContent('Export chatroom');
    expect(screen.queryByText('Archive Chat')).not.toBeInTheDocument();
  });

  it('saves the export, shows the success under the card and does not select the card', async () => {
    mockStatuses.set('chr-1', { state: 'active' });
    const { onSelect } = renderCard(makeChatroom());
    const user = await openMenu();

    await user.click(screen.getByTestId('chatroom-action-export'));

    const success = await screen.findByText(/Exported “Alpha” to chatroom-chr-1-.*\.json\./);
    expect(screen.getByTestId('chatroom-export-feedback')).toContainElement(success);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a retryable failure under the card', async () => {
    mocks.query.mockRejectedValueOnce({
      data: { code: 'EXPORT_CHATROOM_CHANGED', message: 'changed' },
    });
    mockStatuses.set('chr-1', { state: 'active' });
    renderCard(makeChatroom());
    const user = await openMenu();

    await user.click(screen.getByTestId('chatroom-action-export'));

    expect(await screen.findByText('Export failed')).toBeInTheDocument();
    expect(
      screen.getByText('This chatroom changed while exporting. Try again.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
