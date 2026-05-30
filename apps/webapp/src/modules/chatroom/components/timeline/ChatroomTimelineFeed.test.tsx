/**
 * ChatroomTimelineFeed — virtualizer stability and scroll-pin wiring tests.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type React from 'react';

import { TimelineScrollCoordinator } from '../../hooks/timelineScrollCoordinator';
import type { TimelineEvent } from '../../timeline/types';

const virtualizerOptions: Array<{
  count: number;
  getItemKey: (index: number) => string;
  scrollMargin?: number;
  paddingEnd?: number;
}> = [];

const mockScrollToEnd = vi.fn();
const mockScrollToOffset = vi.fn();
const mockMeasure = vi.fn();
const loadOlderEvents = vi.fn();
const purgeOldMessages = vi.fn();

/** Default off; regression tests opt in. */
let mockHasMoreOlder = false;
/** Simulates virtualizer reporting a top index while the DOM is already at bottom. */
let mockFirstVisibleIndex = 0;

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: (typeof virtualizerOptions)[0]) => {
    virtualizerOptions.push(options);
    return {
      getVirtualItems: () => {
        if (mockFirstVisibleIndex < 0) return [];
        return [
          {
            index: mockFirstVisibleIndex,
            start: mockFirstVisibleIndex * 100,
            size: 100,
            key: `row-${mockFirstVisibleIndex}`,
          },
        ];
      },
      getTotalSize: () => options.count * 100,
      measureElement: vi.fn(),
      scrollToEnd: mockScrollToEnd,
      scrollToIndex: vi.fn(),
      scrollToOffset: mockScrollToOffset,
      measure: mockMeasure,
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
    hasMoreOlder: mockHasMoreOlder,
    isLoadingOlder: timelineIsLoadingOlder,
    loadOlderEvents,
    purgeOldMessages,
  }),
}));

import { TIMELINE_PADDING_END, TIMELINE_PURGE_DEBOUNCE_MS } from './timelineVirtualizerConfig';

import { ChatroomTimelineFeed } from './ChatroomTimelineFeed';

function createCoordinatorRef(
  initialPinned = true
): React.MutableRefObject<TimelineScrollCoordinator> {
  return { current: new TimelineScrollCoordinator(initialPinned) };
}

async function flushRaf(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function scrollElProps(el: HTMLElement, scrollTop: number, scrollHeight = 1200) {
  Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
}

/** Pin/unpin the feed scroll container after mount. */
function setScrollPinned(pinned: boolean) {
  act(() => {
    const el = screen.getByTestId('chatroom-timeline-scroll');
    scrollElProps(el, pinned ? 800 : 0);
    el.dispatchEvent(new Event('scroll'));
  });
}

function renderFeed(initialPinned = true) {
  const coordinator = createCoordinatorRef(initialPinned);
  const view = render(
    <ChatroomTimelineFeed chatroomId="room-1" coordinator={coordinator} />
  );
  return { ...view, coordinator };
}

function buildEvents(count: number): TimelineEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `evt-${i}`,
    kind: 'user_message' as const,
    creationTime: i * 100,
    message: {
      _id: `evt-${i}`,
      type: 'message' as const,
      senderRole: 'user',
      content: `Message ${i}`,
      _creationTime: i * 100,
    },
  }));
}

describe('ChatroomTimelineFeed initial tail scroll', () => {
  beforeEach(() => {
    virtualizerOptions.length = 0;
    mockScrollToEnd.mockClear();
    loadOlderEvents.mockClear();
    mockHasMoreOlder = false;
    mockFirstVisibleIndex = -1;
    timelineEvents = buildEvents(3);
    timelineIsLoadingOlder = false;
  });

  it('applies paddingEnd and syncs scrollMargin when top chrome height changes', async () => {
    const { coordinator, rerender } = renderFeed();
    await flushRaf();

    expect(mockScrollToEnd).toHaveBeenCalled();
    expect(virtualizerOptions.at(-1)?.paddingEnd).toBe(TIMELINE_PADDING_END);

    const scroll = screen.getByTestId('chatroom-timeline-scroll');
    const chrome = scroll.firstElementChild as HTMLElement;
    Object.defineProperty(chrome, 'offsetHeight', { configurable: true, value: 40 });

    mockHasMoreOlder = true;
    rerender(<ChatroomTimelineFeed chatroomId="room-1" coordinator={coordinator} />);
    await flushRaf();

    expect(virtualizerOptions.some((o) => o.scrollMargin === 40)).toBe(true);
  });
});

describe('ChatroomTimelineFeed load-older guards', () => {
  beforeEach(() => {
    virtualizerOptions.length = 0;
    mockScrollToEnd.mockClear();
    loadOlderEvents.mockClear();
    mockHasMoreOlder = true;
    mockFirstVisibleIndex = 0;
    timelineEvents = buildEvents(25);
    timelineIsLoadingOlder = false;
  });

  it('does not load older on initial mount when programmatic scroll settles at bottom', async () => {
    const { coordinator } = renderFeed();
    const el = screen.getByTestId('chatroom-timeline-scroll');
    const maxScrollTop = 2500 - 400;
    scrollElProps(el, maxScrollTop, 2500);

    await waitFor(() => {
      expect(coordinator.current.getAllowLoadOlder()).toBe(true);
    });

    // Regression: virtualizer still reports index 0 while DOM is at bottom.
    act(() => {
      el.dispatchEvent(new Event('scroll'));
      el.dispatchEvent(new Event('scroll'));
    });
    await flushRaf();

    expect(loadOlderEvents).not.toHaveBeenCalled();
  });

  it('loads older after the user scrolls near the top', async () => {
    const { coordinator } = renderFeed();
    const el = screen.getByTestId('chatroom-timeline-scroll');
    scrollElProps(el, 2100, 2500);

    await waitFor(() => {
      expect(coordinator.current.getAllowLoadOlder()).toBe(true);
    });

    act(() => {
      scrollElProps(el, 0, 2500);
      el.dispatchEvent(new Event('scroll'));
    });

    expect(loadOlderEvents).toHaveBeenCalledTimes(1);
    expect(coordinator.current.isAtBottom()).toBe(false);
  });
});

describe('ChatroomTimelineFeed virtualizer ref stability', () => {
  beforeEach(() => {
    virtualizerOptions.length = 0;
    mockScrollToEnd.mockClear();
    loadOlderEvents.mockClear();
    mockHasMoreOlder = false;
    mockFirstVisibleIndex = -1;
    timelineEvents = [...baseEvents];
    timelineIsLoadingOlder = false;
  });

  it('enables end-anchored chat virtualizer with followOnAppend only when pinned', () => {
    renderFeed();
    const pinnedOptions = virtualizerOptions.at(-1)! as (typeof virtualizerOptions)[0] & {
      anchorTo?: string;
      followOnAppend?: boolean | 'auto';
    };
    expect(pinnedOptions.anchorTo).toBe('end');
    expect(pinnedOptions.followOnAppend).toBe('auto');

    virtualizerOptions.length = 0;
    render(
      <ChatroomTimelineFeed chatroomId="room-1" coordinator={createCoordinatorRef(false)} />
    );
    const unpinnedOptions = virtualizerOptions.at(-1)! as (typeof virtualizerOptions)[0] & {
      followOnAppend?: boolean | 'auto';
    };
    expect(unpinnedOptions.followOnAppend).toBe(false);
  });

  it('uses stable getItemKey across parent re-renders', () => {
    const { rerender, coordinator } = renderFeed();
    expect(virtualizerOptions.length).toBeGreaterThan(0);

    const firstOptions = virtualizerOptions.at(-1)!;
    const keyBeforeRerender = firstOptions.getItemKey(0);

    rerender(<ChatroomTimelineFeed chatroomId="room-1" coordinator={coordinator} />);

    const secondOptions = virtualizerOptions.at(-1)!;
    expect(secondOptions.getItemKey(0)).toBe(keyBeforeRerender);
    expect(keyBeforeRerender).toBe('evt-1');
  });

  it('configures virtualizer count from timeline events', () => {
    renderFeed();
    const options = virtualizerOptions.at(-1)!;
    expect(options.count).toBe(timelineEvents.length);
  });
});

describe('ChatroomTimelineFeed purge behavior', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    virtualizerOptions.length = 0;
    mockScrollToEnd.mockClear();
    loadOlderEvents.mockClear();
    mockHasMoreOlder = false;
    mockFirstVisibleIndex = -1;
    timelineEvents = buildEvents(80);
    timelineIsLoadingOlder = false;
  });

  it('re-snaps tail after prepended history is purged while pinned', async () => {
    const { rerender, coordinator } = renderFeed();
    await flushRaf();
    await waitFor(() => {
      expect(coordinator.current.getAllowLoadOlder()).toBe(true);
    });

    setScrollPinned(true);
    mockScrollToEnd.mockClear();
    mockFirstVisibleIndex = 40;

    timelineEvents = buildEvents(80).slice(35);

    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" coordinator={coordinator} />);
    });

    await waitFor(
      () => {
        expect(mockScrollToEnd).toHaveBeenCalled();
        expect(coordinator.current.isTailSettling()).toBe(false);
        expect(screen.getByText('Message 75')).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
  });

  it('debounces purge requests while scrolling', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    purgeOldMessages.mockClear();
    const { coordinator } = renderFeed();
    await flushRaf();
    await waitFor(() => {
      expect(coordinator.current.getAllowLoadOlder()).toBe(true);
    });

    mockFirstVisibleIndex = 55;
    const el = screen.getByTestId('chatroom-timeline-scroll');
    scrollElProps(el, 7600, 8000);

    act(() => {
      el.dispatchEvent(new Event('scroll'));
    });

    expect(purgeOldMessages).not.toHaveBeenCalled();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), TIMELINE_PURGE_DEBOUNCE_MS);
    setTimeoutSpy.mockRestore();
  });

  it('does not purge while tail settle is in progress', async () => {
    purgeOldMessages.mockClear();
    const { coordinator } = renderFeed();
    await flushRaf();

    vi.spyOn(coordinator.current, 'isTailSettling').mockReturnValue(true);
    mockFirstVisibleIndex = 55;

    act(() => {
      const el = screen.getByTestId('chatroom-timeline-scroll');
      scrollElProps(el, 7600, 8000);
      el.dispatchEvent(new Event('scroll'));
    });

    expect(purgeOldMessages).not.toHaveBeenCalled();
  });
});

describe('ChatroomTimelineFeed tail follow on send', () => {
  beforeEach(() => {
    virtualizerOptions.length = 0;
    mockScrollToEnd.mockClear();
    loadOlderEvents.mockClear();
    mockHasMoreOlder = false;
    mockFirstVisibleIndex = -1;
    timelineEvents = buildEvents(50);
    timelineIsLoadingOlder = false;
  });

  it('follows tail when a new message is sent (same event count after purge)', async () => {
    const { rerender, coordinator } = renderFeed();
    await flushRaf();
    await waitFor(() => {
      expect(coordinator.current.getAllowLoadOlder()).toBe(true);
    });

    setScrollPinned(true);
    const followTail = vi.spyOn(coordinator.current, 'followTail');
    mockScrollToEnd.mockClear();

    // Simulate subscription slide-off: count unchanged, new tail id.
    timelineEvents = [
      ...buildEvents(49).slice(1),
      {
        id: 'evt-new',
        kind: 'user_message',
        creationTime: 9999,
        message: {
          _id: 'evt-new',
          type: 'message',
          senderRole: 'user',
          content: 'Just sent',
          _creationTime: 9999,
        },
      },
    ];

    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(followTail).toHaveBeenCalled();
    expect(mockScrollToEnd).toHaveBeenCalled();
    followTail.mockRestore();
  });

  it('commits layout when top chrome is still being measured (does not block tail follow)', async () => {
    const { rerender, coordinator } = renderFeed();
    await flushRaf();

    const scroll = screen.getByTestId('chatroom-timeline-scroll');
    const chrome = scroll.firstElementChild as HTMLElement;
    Object.defineProperty(chrome, 'offsetHeight', { configurable: true, value: 48 });

    mockHasMoreOlder = true;
    const followTail = vi.spyOn(coordinator.current, 'followTail');
    mockScrollToEnd.mockClear();

    timelineEvents = [
      ...timelineEvents,
      {
        id: 'evt-append',
        kind: 'user_message',
        creationTime: 5000,
        message: {
          _id: 'evt-append',
          type: 'message',
          senderRole: 'user',
          content: 'Another',
          _creationTime: 5000,
        },
      },
    ];

    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(followTail).toHaveBeenCalled();
    followTail.mockRestore();
  });
});

describe('ChatroomTimelineFeed scroll pin behavior', () => {
  beforeEach(() => {
    virtualizerOptions.length = 0;
    mockScrollToEnd.mockClear();
    loadOlderEvents.mockClear();
    mockHasMoreOlder = false;
    mockFirstVisibleIndex = -1;
    timelineEvents = [...baseEvents];
    timelineIsLoadingOlder = false;
  });

  it('stays pinned at bottom when new messages arrive (no jump chip)', async () => {
    const { rerender, coordinator } = renderFeed();
    await flushRaf();
    setScrollPinned(true);

    const followTail = vi.spyOn(coordinator.current, 'followTail');
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

    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(followTail).toHaveBeenCalled();
    expect(mockScrollToEnd).toHaveBeenCalled();
    expect(coordinator.current.isPinned).toBe(true);
    expect(screen.queryByRole('button', { name: 'Jump to new messages' })).toBeNull();
    followTail.mockRestore();
  });

  it('follows tail on append when physically at bottom', async () => {
    const { rerender, coordinator } = renderFeed();
    await flushRaf();
    setScrollPinned(true);
    const followTail = vi.spyOn(coordinator.current, 'followTail');
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

    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(followTail).toHaveBeenCalled();
    expect(mockScrollToEnd).toHaveBeenCalled();
    expect(coordinator.current.isPinned).toBe(true);
    followTail.mockRestore();
  });

  it('does not auto-scroll when scrolled up and shows jump chip', async () => {
    const { rerender, coordinator } = renderFeed(false);
    await flushRaf();

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

    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(mockScrollToEnd).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Jump to new messages' })).toBeInTheDocument();
  });

  it('scrolls to end when jump chip is clicked', async () => {
    const user = userEvent.setup();
    const { coordinator } = renderFeed(false);
    await flushRaf();

    mockScrollToEnd.mockClear();

    await user.click(screen.getByRole('button', { name: 'Jump to new messages' }));

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    expect(mockScrollToEnd).toHaveBeenCalled();
    expect(coordinator.current.isPinned).toBe(true);
  });

  it('does not call DOM scrollTop delta on prepend (virtualizer anchors)', async () => {
    timelineIsLoadingOlder = true;

    const { rerender, coordinator } = renderFeed();
    await flushRaf();
    const el = screen.getByTestId('chatroom-timeline-scroll');
    scrollElProps(el, 50, 500);

    const scrollTopBefore = el.scrollTop;

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

    scrollElProps(el, scrollTopBefore, 700);

    mockScrollToEnd.mockClear();

    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(el.scrollTop).toBe(scrollTopBefore);
    expect(mockScrollToEnd).not.toHaveBeenCalled();
  });
});
