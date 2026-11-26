import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationPanel } from './ConversationPanel';

const mockUseConversation = vi.fn();
const mockUseHandoffNotification = vi.fn();
const { mockComposerPreflightBar } = vi.hoisted(() => ({
  mockComposerPreflightBar: vi.fn(),
}));

vi.mock('./hooks/useConversation', () => ({
  useConversation: (...args: unknown[]) => mockUseConversation(...args),
}));

vi.mock('../../hooks/useHandoffNotification', () => ({
  useHandoffNotification: (...args: unknown[]) => mockUseHandoffNotification(...args),
}));

vi.mock('../../components/timeline/ComposerPreflightBar', () => ({
  ComposerPreflightBar: (props: unknown) => {
    mockComposerPreflightBar(props);
    return <div data-testid="composer-preflight-bar" />;
  },
}));

vi.mock('../../context/ChatroomListingContext', () => ({
  useChatroomListing: () => ({
    chatrooms: [{ _id: 'room-1', name: 'Foo', teamName: 'Duo' }],
    isLoading: false,
  }),
}));

vi.mock('../../components/QueuedMessagesIndicator', () => ({
  QueuedMessagesIndicator: () => <div data-testid="queued-messages-indicator" />,
}));

vi.mock('../../components/timeline/TimelineEventRow', () => ({
  TimelineEventRow: ({ event }: { event: { id: string; message: { content: string } } }) => (
    <div data-testid={`event-row-${event.id}`}>{event.message.content}</div>
  ),
}));

describe('ConversationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseConversation.mockReturnValue({
      events: [],
      messages: [],
      pageNav: null,
      isLoading: false,
      isLoadingMore: false,
      canLoadMore: false,
      loadMore: vi.fn(),
      goToPrevPage: vi.fn(),
      goToNextPage: vi.fn(),
      hasPrevPage: false,
      hasNextPage: false,
      isOnLatestPage: true,
      pageId: null,
      goToLatestPage: vi.fn(),
    });
  });

  it('renders page navigator during loading state', () => {
    mockUseConversation.mockReturnValue({
      events: [],
      messages: [],
      pageNav: null,
      isLoading: true,
      hasPrevPage: true,
      hasNextPage: false,
      isOnLatestPage: false,
      goToPrevPage: vi.fn(),
      goToNextPage: vi.fn(),
      goToLatestPage: vi.fn(),
    });

    render(<ConversationPanel chatroomId="room-1" />);
    expect(screen.getByTestId('conversation-page-navigator')).toBeDefined();
    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByLabelText('Previous user message')).toBeDefined();
    expect(screen.getByLabelText('Jump to latest')).toBeDefined();
    expect(screen.getByLabelText('Next user message')).toBeDefined();
  });

  it('renders page navigator with jump to latest when on latest page', () => {
    render(<ConversationPanel chatroomId="room-1" />);

    expect(screen.getByTestId('conversation-page-navigator')).toBeDefined();
    const jumpButton = screen.getByRole('button', { name: 'Jump to latest' });
    expect((jumpButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders message list and navigator with page preview', () => {
    mockUseConversation.mockReturnValue({
      events: [
        {
          id: 'msg-1',
          kind: 'user_message' as const,
          creationTime: 100,
          message: { _id: 'msg-1', content: 'hello' },
        },
      ],
      messages: [{ _id: 'msg-1', content: 'hello' }],
      pageNav: {
        pages: [{ pageId: 'page-1', startedAt: 100, endExclusive: null, contentPreview: 'hello' }],
        selectedPageId: 'page-1',
        prevPageId: null,
        nextPageId: null,
      },
      isLoading: false,
      hasPrevPage: false,
      hasNextPage: false,
      isOnLatestPage: true,
    });

    render(<ConversationPanel chatroomId="room-1" />);

    expect(screen.getByTestId('conversation-page-navigator')).toBeDefined();
    expect(screen.getByTestId('event-row-msg-1')).toBeDefined();
  });

  it('disables arrow buttons at bounds', () => {
    render(<ConversationPanel chatroomId="room-1" />);

    const prevButton = screen.getByLabelText('Previous user message');
    const nextButton = screen.getByLabelText('Next user message');
    expect((prevButton as HTMLButtonElement).disabled).toBe(true);
    expect((nextButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables arrow buttons when pages exist', () => {
    mockUseConversation.mockReturnValue({
      events: [],
      messages: [],
      pageNav: {
        pages: [{ pageId: 'page-1', startedAt: 100, endExclusive: 200, contentPreview: 'middle' }],
        selectedPageId: 'page-1',
        prevPageId: 'page-prev',
        nextPageId: 'page-next',
      },
      isLoading: false,
      hasPrevPage: true,
      hasNextPage: true,
      isOnLatestPage: false,
    });

    render(<ConversationPanel chatroomId="room-1" />);

    const prevButton = screen.getByLabelText('Previous user message');
    const nextButton = screen.getByLabelText('Next user message');
    expect((prevButton as HTMLButtonElement).disabled).toBe(false);
    expect((nextButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('registers conversation navigation actions on mount', () => {
    const goToLatestPage = vi.fn();
    const onRegisterConversationNavigation = vi.fn();
    mockUseConversation.mockReturnValue({
      events: [],
      messages: [],
      pageNav: null,
      isLoading: false,
      hasPrevPage: false,
      hasNextPage: false,
      goToPrevPage: vi.fn(),
      goToNextPage: vi.fn(),
      pageId: null,
      goToLatestPage,
    });

    render(
      <ConversationPanel
        chatroomId="room-1"
        onRegisterConversationNavigation={onRegisterConversationNavigation}
      />
    );

    expect(onRegisterConversationNavigation).toHaveBeenCalledWith({ goToLatestPage });
  });

  it('passes the matching chatroom to useHandoffNotification', () => {
    render(<ConversationPanel chatroomId="room-1" />);

    expect(mockUseHandoffNotification).toHaveBeenCalledWith(
      expect.anything(),
      'room-1',
      expect.objectContaining({ name: 'Foo' })
    );
  });

  it('forwards onRequestComposerFocus to ComposerPreflightBar', () => {
    const onRequestComposerFocus = vi.fn();
    render(
      <ConversationPanel chatroomId="room-1" onRequestComposerFocus={onRequestComposerFocus} />
    );

    expect(mockComposerPreflightBar).toHaveBeenCalledWith(
      expect.objectContaining({ onRequestComposerFocus })
    );
  });
});
