/**
 * FilteredUserMessagesView — user-only message list with conversation slice panel.
 */

// matchMedia polyfill needed by useIsDesktop (used by MessageDownloadMenu)
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FilteredUserMessagesView } from './FilteredUserMessagesView';
import { AttachmentsProvider } from '../../attachments';
import type { Message } from '../../types/message';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const TEST_CHATROOM_ID = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2';

let mockFilteredMessages: Message[] = [];
let mockIsLoading = false;
let mockConversationSliceEvents: ReturnType<typeof makeTimelineEvent>[] = [];

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    _id: 'msg-1',
    type: 'message',
    senderRole: 'user',
    content: 'Hello filtered view',
    _creationTime: 1_000,
    ...overrides,
  };
}

function makeTimelineEvent(id: string) {
  return {
    id,
    creationTime: 1_000,
    kind: 'user_message' as const,
    message: makeMessage({ _id: id, content: `Slice message ${id}` }),
  };
}

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: { count: number; getItemKey?: (index: number) => unknown }) => {
    const items = Array.from({ length: options.count }, (_, index) => ({
      index,
      key: options.getItemKey?.(index) ?? index,
      start: index * 120,
      size: 120,
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => options.count * 120,
      measureElement: () => undefined,
    };
  },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
}));

vi.mock('../../hooks/useFilteredMessagesByRole', () => ({
  useFilteredMessagesByRole: () => ({
    messages: mockFilteredMessages,
    isLoading: mockIsLoading,
    isLoadingMore: false,
    canLoadMore: false,
    loadMore: vi.fn(),
  }),
}));

vi.mock('../../hooks/useConversationSlice', () => ({
  useConversationSlice: () => ({
    events: mockConversationSliceEvents,
    isLoading: false,
    isLoadingMore: false,
    canLoadMore: false,
    loadMore: vi.fn(),
  }),
}));

function renderView(ui: React.ReactElement) {
  return render(<AttachmentsProvider>{ui}</AttachmentsProvider>);
}

describe('FilteredUserMessagesView', () => {
  beforeEach(() => {
    mockFilteredMessages = [];
    mockIsLoading = false;
    mockConversationSliceEvents = [];
  });

  it('renders loading state when hook reports loading', () => {
    mockIsLoading = true;
    renderView(<FilteredUserMessagesView chatroomId={TEST_CHATROOM_ID} senderRole="user" />);
    expect(screen.getByTestId('filtered-user-messages-view')).toBeInTheDocument();
    expect(screen.queryByText('No user messages yet')).not.toBeInTheDocument();
  });

  it('renders empty state when no messages', () => {
    renderView(<FilteredUserMessagesView chatroomId={TEST_CHATROOM_ID} senderRole="user" />);
    expect(screen.getByText('No user messages yet')).toBeInTheDocument();
  });

  it('renders user message rows from hook data', () => {
    mockFilteredMessages = [
      makeMessage({ _id: 'msg-a', content: 'First user message' }),
      makeMessage({ _id: 'msg-b', content: 'Second user message' }),
    ];
    renderView(<FilteredUserMessagesView chatroomId={TEST_CHATROOM_ID} senderRole="user" />);
    expect(screen.getByText('First user message')).toBeInTheDocument();
    expect(screen.getByText('Second user message')).toBeInTheDocument();
    expect(screen.getByTestId('filtered-user-message-msg-a')).toBeInTheDocument();
    expect(screen.getByTestId('filtered-user-message-msg-b')).toBeInTheDocument();
  });

  it('clicking a message shows conversation slice panel', async () => {
    const user = userEvent.setup();
    mockFilteredMessages = [makeMessage({ _id: 'anchor-msg', content: 'Anchor message' })];
    mockConversationSliceEvents = [makeTimelineEvent('anchor-msg')];

    renderView(<FilteredUserMessagesView chatroomId={TEST_CHATROOM_ID} senderRole="user" />);

    expect(screen.queryByTestId('conversation-slice-panel')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('filtered-user-message-anchor-msg'));

    expect(screen.getAllByTestId('conversation-slice-panel').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Slice message anchor-msg').length).toBeGreaterThan(0);
  });

  it('does not nest interactive buttons inside the selectable message row', () => {
    mockFilteredMessages = [makeMessage({ _id: 'msg-a', content: 'First user message' })];

    renderView(<FilteredUserMessagesView chatroomId={TEST_CHATROOM_ID} senderRole="user" />);

    const row = screen.getByTestId('filtered-user-message-msg-a');
    expect(row.tagName).toBe('DIV');
    expect(row).toHaveAttribute('role', 'button');

    const nestedButtons = row.querySelectorAll('button');
    expect(nestedButtons.length).toBeGreaterThan(0);
    nestedButtons.forEach((button) => {
      expect(button.closest('button')).toBe(button);
    });
  });
});
