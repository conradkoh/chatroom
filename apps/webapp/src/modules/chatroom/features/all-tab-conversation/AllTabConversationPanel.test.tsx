import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AllTabConversationPanel } from './AllTabConversationPanel';

const mockUseAllTabConversation = vi.fn();
const mockUseHandoffNotification = vi.fn();

vi.mock('./hooks/useAllTabConversation', () => ({
  useAllTabConversation: (...args: unknown[]) => mockUseAllTabConversation(...args),
}));

vi.mock('../../hooks/useHandoffNotification', () => ({
  useHandoffNotification: (...args: unknown[]) => mockUseHandoffNotification(...args),
}));

vi.mock('../../components/timeline/ComposerPreflightBar', () => ({
  ComposerPreflightBar: () => <div data-testid="composer-preflight-bar" />,
}));

vi.mock('../../components/QueuedMessagesIndicator', () => ({
  QueuedMessagesIndicator: () => <div data-testid="queued-messages-indicator" />,
}));

vi.mock('../../components/timeline/TimelineEventRow', () => ({
  TimelineEventRow: ({ event }: { event: { id: string; message: { content: string } } }) => (
    <div data-testid={`event-row-${event.id}`}>{event.message.content}</div>
  ),
}));

describe('AllTabConversationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAllTabConversation.mockReturnValue({
      events: [],
      messages: [],
      nav: null,
      isLoading: false,
      isLoadingMore: false,
      canLoadMore: false,
      loadMore: vi.fn(),
      goToPrev: vi.fn(),
      goToNext: vi.fn(),
      hasPrev: false,
      hasNext: false,
      isOnLatestAnchor: true,
      anchorId: null,
      goToLatestAnchor: vi.fn(),
    });
  });

  it('renders anchor navigator during loading state', () => {
    mockUseAllTabConversation.mockReturnValue({
      events: [],
      messages: [],
      nav: null,
      isLoading: true,
      hasPrev: true,
      hasNext: false,
      isOnLatestAnchor: false,
      goToPrev: vi.fn(),
      goToNext: vi.fn(),
      goToLatestAnchor: vi.fn(),
    });

    render(<AllTabConversationPanel chatroomId="room-1" />);
    expect(screen.getByTestId('all-tab-anchor-navigator')).toBeDefined();
    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByLabelText('Previous user message')).toBeDefined();
    expect(screen.getByLabelText('Jump to latest')).toBeDefined();
    expect(screen.getByLabelText('Next user message')).toBeDefined();
  });

  it('renders anchor navigator with jump to latest when on latest anchor', () => {
    render(<AllTabConversationPanel chatroomId="room-1" />);

    expect(screen.getByTestId('all-tab-anchor-navigator')).toBeDefined();
    const jumpButton = screen.getByRole('button', { name: 'Jump to latest' });
    expect((jumpButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders message list and navigator with anchor preview', () => {
    mockUseAllTabConversation.mockReturnValue({
      events: [
        {
          id: 'msg-1',
          kind: 'user_message' as const,
          creationTime: 100,
          message: { _id: 'msg-1', content: 'hello' },
        },
      ],
      messages: [{ _id: 'msg-1', content: 'hello' }],
      nav: {
        anchor: { _id: 'anchor-1', _creationTime: 100, contentPreview: 'hello' },
        prevAnchorId: null,
        nextAnchorId: null,
        sliceUpperBoundExclusive: null,
      },
      isLoading: false,
      hasPrev: false,
      hasNext: false,
      isOnLatestAnchor: true,
    });

    render(<AllTabConversationPanel chatroomId="room-1" />);

    expect(screen.getByTestId('all-tab-anchor-navigator')).toBeDefined();
    expect(screen.getByTestId('event-row-msg-1')).toBeDefined();
  });

  it('disables arrow buttons at bounds', () => {
    render(<AllTabConversationPanel chatroomId="room-1" />);

    const prevButton = screen.getByLabelText('Previous user message');
    const nextButton = screen.getByLabelText('Next user message');
    expect((prevButton as HTMLButtonElement).disabled).toBe(true);
    expect((nextButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables arrow buttons when anchors exist', () => {
    mockUseAllTabConversation.mockReturnValue({
      events: [],
      messages: [],
      nav: {
        anchor: { _id: 'anchor-1', _creationTime: 100, contentPreview: 'middle' },
        prevAnchorId: 'anchor-prev',
        nextAnchorId: 'anchor-next',
        sliceUpperBoundExclusive: 200,
      },
      isLoading: false,
      hasPrev: true,
      hasNext: true,
      isOnLatestAnchor: false,
    });

    render(<AllTabConversationPanel chatroomId="room-1" />);

    const prevButton = screen.getByLabelText('Previous user message');
    const nextButton = screen.getByLabelText('Next user message');
    expect((prevButton as HTMLButtonElement).disabled).toBe(false);
    expect((nextButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('registers all-tab navigation actions on mount', () => {
    const goToLatestAnchor = vi.fn();
    const onRegisterAllTabNavigation = vi.fn();
    mockUseAllTabConversation.mockReturnValue({
      events: [],
      messages: [],
      nav: null,
      isLoading: false,
      hasPrev: false,
      hasNext: false,
      goToPrev: vi.fn(),
      goToNext: vi.fn(),
      anchorId: null,
      goToLatestAnchor,
    });

    render(
      <AllTabConversationPanel
        chatroomId="room-1"
        onRegisterAllTabNavigation={onRegisterAllTabNavigation}
      />
    );

    expect(onRegisterAllTabNavigation).toHaveBeenCalledWith({ goToLatestAnchor });
  });
});
