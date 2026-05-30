/**
 * ChatroomTimelineFeed — virtualizer stability and scroll-pin wiring tests.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type React from 'react';

import type { ScrollController } from '../../hooks/useScrollController';
import type { TimelineEvent } from '../../timeline/types';

const virtualizerOptions: Array<{
  count: number;
  getItemKey: (index: number) => string;
}> = [];

const mockScrollToEnd = vi.fn();

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: (typeof virtualizerOptions)[0]) => {
    virtualizerOptions.push(options);
    return {
      getVirtualItems: () => [],
      getTotalSize: () => options.count * 100,
      measureElement: vi.fn(),
      scrollToEnd: mockScrollToEnd,
      range: { startIndex: 0, endIndex: 0, count: options.count },
    };
  },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => [],
  useSessionId: () => ['session-1'],
}));

vi.mock('convex/react', () => ({
  usePaginatedQuery: () => ({
    results: [],
    status: 'Exhausted',
    loadMore: vi.fn(),
  }),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    events: {
      listLatestEvents: 'listLatestEvents',
      listLatestEventsPaginated: 'listLatestEventsPaginated',
    },
  },
}));

vi.mock('../QueuedMessagesIndicator', () => ({
  QueuedMessagesIndicator: () => null,
}));

vi.mock('../EventStreamModal', () => ({
  EventStreamModal: () => null,
}));

vi.mock('../../hooks/useHandoffNotification', () => ({
  useHandoffNotification: vi.fn(),
}));

const scrollController = {
  attach: vi.fn(),
  detach: vi.fn(),
  isPinned: true,
  isAtBottom: vi.fn(() => false),
  onNewMessages: vi.fn(),
  scrollToBottom: vi.fn(),
  snapToBottom: vi.fn(),
  pinToEnd: vi.fn(),
};

const baseEvents: TimelineEvent[] = [
  {
    id: 'evt-1',
    kind: 'user_message',
    creationTime: 100,
    message: {
      _id: 'evt-1',
      type: 'message',
      senderRole: 'user',
      content: 'Hello',
      _creationTime: 100,
    },
  },
  {
    id: 'evt-2',
    kind: 'team_message',
    creationTime: 200,
    message: {
      _id: 'evt-2',
      type: 'message',
      senderRole: 'builder',
      content: 'Reply',
      _creationTime: 200,
    },
  },
];

let timelineEvents = [...baseEvents];
let timelineIsLoadingOlder = false;

vi.mock('../../hooks/useChatroomTimeline', () => ({
  useChatroomTimeline: () => ({
    events: timelineEvents,
    isLoading: false,
    hasMoreOlder: false,
    isLoadingOlder: timelineIsLoadingOlder,
    loadOlderEvents: vi.fn(),
    purgeOldMessages: vi.fn(),
  }),
}));

import { ChatroomTimelineFeed } from './ChatroomTimelineFeed';

function renderFeed(isPinned: boolean) {
  return render(
    <ChatroomTimelineFeed
      chatroomId="room-1"
      controller={
        { current: scrollController } as unknown as React.MutableRefObject<ScrollController>
      }
      isPinned={isPinned}
    />
  );
}

describe('ChatroomTimelineFeed virtualizer ref stability', () => {
  beforeEach(() => {
    virtualizerOptions.length = 0;
    mockScrollToEnd.mockClear();
    scrollController.attach.mockClear();
    scrollController.detach.mockClear();
    scrollController.onNewMessages.mockClear();
    scrollController.pinToEnd.mockClear();
    timelineEvents = [...baseEvents];
    timelineIsLoadingOlder = false;
  });

  it('enables end-anchored chat virtualizer with followOnAppend only when pinned', () => {
    renderFeed(true);
    const pinnedOptions = virtualizerOptions.at(-1)! as (typeof virtualizerOptions)[0] & {
      anchorTo?: string;
      followOnAppend?: boolean | 'auto';
    };
    expect(pinnedOptions.anchorTo).toBe('end');
    expect(pinnedOptions.followOnAppend).toBe('auto');

    renderFeed(false);
    const unpinnedOptions = virtualizerOptions.at(-1)! as (typeof virtualizerOptions)[0] & {
      followOnAppend?: boolean | 'auto';
    };
    expect(unpinnedOptions.followOnAppend).toBe(false);
  });

  it('uses stable getItemKey across parent re-renders', () => {
    const { rerender } = renderFeed(true);
    expect(virtualizerOptions.length).toBeGreaterThan(0);

    const firstOptions = virtualizerOptions.at(-1)!;
    const keyBeforeRerender = firstOptions.getItemKey(0);
    const keySecondRow = firstOptions.getItemKey(1);

    rerender(
      <ChatroomTimelineFeed
        chatroomId="room-1"
        controller={
          { current: scrollController } as unknown as React.MutableRefObject<ScrollController>
        }
        isPinned={true}
      />
    );

    const secondOptions = virtualizerOptions.at(-1)!;
    expect(secondOptions.getItemKey(0)).toBe(keyBeforeRerender);
    expect(secondOptions.getItemKey(1)).toBe(keySecondRow);
    expect(keyBeforeRerender).toBe('evt-1');
    expect(keySecondRow).toBe('evt-2');
  });

  it('configures virtualizer count from timeline events', () => {
    renderFeed(true);
    const options = virtualizerOptions.at(-1)!;
    expect(options.count).toBe(timelineEvents.length);
  });
});

describe('ChatroomTimelineFeed scroll pin behavior', () => {
  beforeEach(() => {
    virtualizerOptions.length = 0;
    mockScrollToEnd.mockClear();
    scrollController.onNewMessages.mockClear();
    scrollController.pinToEnd.mockClear();
    timelineEvents = [...baseEvents];
    timelineIsLoadingOlder = false;
  });

  it('stays pinned at bottom when new messages arrive (no jump chip)', () => {
    const { rerender } = renderFeed(true);

    mockScrollToEnd.mockClear();
    scrollController.snapToBottom.mockClear();

    timelineEvents = [
      ...baseEvents,
      {
        id: 'evt-3',
        kind: 'team_message',
        creationTime: 300,
        message: {
          _id: 'evt-3',
          type: 'message',
          senderRole: 'builder',
          content: 'New reply',
          _creationTime: 300,
        },
      },
    ];

    rerender(
      <ChatroomTimelineFeed
        chatroomId="room-1"
        controller={
          { current: scrollController } as unknown as React.MutableRefObject<ScrollController>
        }
        isPinned={true}
      />
    );

    expect(mockScrollToEnd).toHaveBeenCalled();
    expect(scrollController.snapToBottom).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Jump to new messages' })).toBeNull();
  });

  it('follows tail on append when at bottom even if isPinned prop is false', () => {
    vi.mocked(scrollController.isAtBottom).mockReturnValue(true);
    Object.defineProperty(scrollController, 'isPinned', { value: false, configurable: true });

    const { rerender } = renderFeed(false);

    mockScrollToEnd.mockClear();
    scrollController.snapToBottom.mockClear();

    timelineEvents = [
      ...baseEvents,
      {
        id: 'evt-3',
        kind: 'team_message',
        creationTime: 300,
        message: {
          _id: 'evt-3',
          type: 'message',
          senderRole: 'builder',
          content: 'New reply',
          _creationTime: 300,
        },
      },
    ];

    rerender(
      <ChatroomTimelineFeed
        chatroomId="room-1"
        controller={
          { current: scrollController } as unknown as React.MutableRefObject<ScrollController>
        }
        isPinned={false}
      />
    );

    expect(mockScrollToEnd).toHaveBeenCalled();
    expect(scrollController.snapToBottom).toHaveBeenCalled();

    Object.defineProperty(scrollController, 'isPinned', { value: true, configurable: true });
    vi.mocked(scrollController.isAtBottom).mockReturnValue(false);
  });

  it('does not auto-scroll when scrolled up and shows jump chip', () => {
    vi.mocked(scrollController.isAtBottom).mockReturnValue(false);
    Object.defineProperty(scrollController, 'isPinned', { value: false, configurable: true });

    const { rerender } = renderFeed(false);

    mockScrollToEnd.mockClear();

    timelineEvents = [
      ...baseEvents,
      {
        id: 'evt-3',
        kind: 'team_message',
        creationTime: 300,
        message: {
          _id: 'evt-3',
          type: 'message',
          senderRole: 'builder',
          content: 'New reply',
          _creationTime: 300,
        },
      },
    ];

    rerender(
      <ChatroomTimelineFeed
        chatroomId="room-1"
        controller={
          { current: scrollController } as unknown as React.MutableRefObject<ScrollController>
        }
        isPinned={false}
      />
    );

    expect(mockScrollToEnd).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Jump to new messages' })).toBeInTheDocument();
  });

  it('scrolls to end and re-pins when jump chip is clicked', async () => {
    const user = userEvent.setup();
    renderFeed(false);

    // Flush initial `follow` scroll rAFs so they do not count toward the jump assertion.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    mockScrollToEnd.mockClear();
    scrollController.pinToEnd.mockClear();
    scrollController.snapToBottom.mockClear();

    await user.click(screen.getByRole('button', { name: 'Jump to new messages' }));

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    expect(scrollController.pinToEnd).toHaveBeenCalled();
    expect(scrollController.snapToBottom).not.toHaveBeenCalled();
    expect(mockScrollToEnd).toHaveBeenCalled();
  });

  it('preserves scroll position when loading older messages near top', () => {
    timelineIsLoadingOlder = true;

    const { rerender } = renderFeed(true);

    const attachedEl = scrollController.attach.mock.calls.at(-1)?.[0] as
      | HTMLDivElement
      | undefined;
    if (attachedEl) {
      Object.defineProperty(attachedEl, 'scrollHeight', { value: 500, configurable: true });
      Object.defineProperty(attachedEl, 'scrollTop', { value: 50, writable: true, configurable: true });
    }

    scrollController.onNewMessages.mockClear();

    timelineEvents = [
      {
        id: 'evt-0',
        kind: 'user_message',
        creationTime: 50,
        message: {
          _id: 'evt-0',
          type: 'message',
          senderRole: 'user',
          content: 'Older',
          _creationTime: 50,
        },
      },
      ...baseEvents,
    ];

    if (attachedEl) {
      Object.defineProperty(attachedEl, 'scrollHeight', { value: 700, configurable: true });
    }

    rerender(
      <ChatroomTimelineFeed
        chatroomId="room-1"
        controller={
          { current: scrollController } as unknown as React.MutableRefObject<ScrollController>
        }
        isPinned={true}
      />
    );

    expect(scrollController.onNewMessages).toHaveBeenCalledWith(expect.any(Number), true, true);
  });
});
