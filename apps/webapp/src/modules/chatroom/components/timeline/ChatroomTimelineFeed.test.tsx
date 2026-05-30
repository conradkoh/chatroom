/**
 * ChatroomTimelineFeed — virtualizer stability and scroll-pin wiring tests.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type React from 'react';

import { TimelineScrollCoordinator } from '../../hooks/timelineScrollCoordinator';
import type { TimelineEvent } from '../../timeline/types';

const virtualizerOptions: Array<{
  count: number;
  getItemKey: (index: number) => string;
  scrollMargin?: number;
  paddingEnd?: number;
  overscan?: number;
}> = [];

let lastVirtualizerInstance: Record<string, unknown> | null = null;

const mockScrollToEnd = vi.fn();
const mockScrollToOffset = vi.fn();
const mockScrollToIndex = vi.fn((index: number) => {
  const el = document.querySelector('[data-testid="chatroom-timeline-scroll"]');
  if (el) {
    Object.defineProperty(el, 'scrollTop', {
      value: index * 100,
      writable: true,
      configurable: true,
    });
  }
});
const loadOlderEvents = vi.fn();

/** Default off; regression tests opt in. */
let mockHasMoreOlder = false;
/** Simulates virtualizer reporting a top index while the DOM is already at bottom. */
let mockFirstVisibleIndex = 0;

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: (typeof virtualizerOptions)[0]) => {
    virtualizerOptions.push(options);
    const instance = {
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
      scrollToIndex: mockScrollToIndex,
      scrollToOffset: mockScrollToOffset,
      range: { startIndex: 0, endIndex: 0, count: options.count },
    };
    lastVirtualizerInstance = instance;
    return instance;
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
  }),
}));

import {
  TIMELINE_EAGER_MEASURE_MAX_COUNT,
  TIMELINE_OVERSCAN,
  TIMELINE_PADDING_END,
} from './timelineVirtualizerConfig';

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

  it('does not load older on a small scroll up when the virtualizer reports index 0', async () => {
    const { coordinator } = renderFeed();
    const el = screen.getByTestId('chatroom-timeline-scroll');
    const maxScrollTop = 2500 - 400;
    scrollElProps(el, maxScrollTop, 2500);

    await waitFor(() => {
      expect(coordinator.current.getAllowLoadOlder()).toBe(true);
    });

    act(() => {
      scrollElProps(el, maxScrollTop - 100, 2500);
      el.dispatchEvent(new Event('scroll'));
    });

    expect(loadOlderEvents).not.toHaveBeenCalled();
  });

  it('does not load older when scrolled up ~8 rows from the bottom', async () => {
    const { coordinator } = renderFeed();
    const el = screen.getByTestId('chatroom-timeline-scroll');
    const maxScrollTop = 2500 - 400;
    scrollElProps(el, maxScrollTop, 2500);

    await waitFor(() => {
      expect(coordinator.current.getAllowLoadOlder()).toBe(true);
    });

    mockFirstVisibleIndex = 12;

    act(() => {
      scrollElProps(el, maxScrollTop - 8 * 100, 2500);
      el.dispatchEvent(new Event('scroll'));
    });

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
    lastVirtualizerInstance = null;
    mockScrollToEnd.mockClear();
    loadOlderEvents.mockClear();
    mockHasMoreOlder = false;
    mockFirstVisibleIndex = -1;
    timelineEvents = [...baseEvents];
    timelineIsLoadingOlder = false;
  });

  it('disables scroll adjustment on row measurement and expands overscan for small feeds', async () => {
    timelineEvents = buildEvents(20);
    renderFeed();
    await flushRaf();

    expect(virtualizerOptions.at(-1)?.overscan).toBe(20);
    const shouldAdjust = lastVirtualizerInstance?.shouldAdjustScrollPositionOnItemSizeChange as
      | (() => boolean)
      | undefined;
    expect(shouldAdjust?.()).toBe(false);
  });

  it('uses default overscan for large feeds', () => {
    timelineEvents = buildEvents(TIMELINE_EAGER_MEASURE_MAX_COUNT + 10);
    renderFeed();
    expect(virtualizerOptions.at(-1)?.overscan).toBe(TIMELINE_OVERSCAN);
  });

  it('keeps followOnAppend false regardless of pin state', async () => {
    const { rerender, coordinator } = renderFeed();
    await flushRaf();

    const el = screen.getByTestId('chatroom-timeline-scroll');
    scrollElProps(el, 600, 1000);
    act(() => {
      el.dispatchEvent(new Event('scroll'));
    });
    rerender(<ChatroomTimelineFeed chatroomId="room-1" coordinator={coordinator} />);

    const pinnedOptions = virtualizerOptions.at(-1)! as (typeof virtualizerOptions)[0] & {
      anchorTo?: string;
      followOnAppend?: boolean | 'auto';
    };
    expect(pinnedOptions.anchorTo).toBe('end');
    expect(pinnedOptions.followOnAppend).toBe(false);

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

  it('follows tail when a new message is sent (same event count after subscription slide-off)', async () => {
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

  it('does not jump scroll position when unpinning and jump chip appears', async () => {
    timelineEvents = buildEvents(25);
    const { coordinator } = renderFeed(true);
    await flushRaf();

    const el = screen.getByTestId('chatroom-timeline-scroll');
    const maxScrollTop = 2500 - 400;
    scrollElProps(el, maxScrollTop, 2500);

    await waitFor(() => {
      expect(coordinator.current.getAllowLoadOlder()).toBe(true);
    });

    const scrollUpBy = 300;
    const targetScrollTop = maxScrollTop - scrollUpBy;

    act(() => {
      scrollElProps(el, targetScrollTop, 2500);
      el.dispatchEvent(new Event('scroll'));
    });

    await waitFor(() => {
      expect(coordinator.current.isPinned).toBe(false);
    });

    expect(el.scrollTop).toBe(targetScrollTop);
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

});

describe('ChatroomTimelineFeed load-more scroll preservation', () => {
  beforeEach(() => {
    virtualizerOptions.length = 0;
    mockScrollToEnd.mockClear();
    mockScrollToOffset.mockClear();
    mockScrollToIndex.mockClear();
    loadOlderEvents.mockClear();
    mockHasMoreOlder = true;
    mockFirstVisibleIndex = 2;
    timelineEvents = buildEvents(25);
    timelineIsLoadingOlder = false;
  });

  it('preserves viewport when older messages arrive after load-more (no tail snap)', async () => {
    const { rerender, coordinator } = renderFeed();
    const el = screen.getByTestId('chatroom-timeline-scroll');
    const maxScrollTop = 2500 - 400;
    scrollElProps(el, maxScrollTop * 0.08, 2500);

    await waitFor(() => {
      expect(coordinator.current.getAllowLoadOlder()).toBe(true);
    });

    act(() => {
      scrollElProps(el, maxScrollTop * 0.08, 2500);
      el.dispatchEvent(new Event('scroll'));
    });
    expect(loadOlderEvents).toHaveBeenCalledTimes(1);
    expect(coordinator.current.isPinned).toBe(false);

    const followTail = vi.spyOn(coordinator.current, 'followTail');
    mockScrollToEnd.mockClear();

    timelineIsLoadingOlder = true;
    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" coordinator={coordinator} />);
    });

    const olderBatch = buildEvents(20).map((e, i) => ({
      ...e,
      id: `older-${i}`,
      message: { ...e.message, _id: `older-${i}`, content: `Older ${i}` },
    }));
    timelineEvents = [...olderBatch, ...buildEvents(25)];
    timelineIsLoadingOlder = false;
    const scrollTopBeforeLoad = maxScrollTop * 0.08;
    const expectedScrollTopAfterPrepend = scrollTopBeforeLoad + 20 * 100;
    scrollElProps(el, scrollTopBeforeLoad, 4500);

    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(el.scrollTop).toBe(expectedScrollTopAfterPrepend);
    expect(followTail).not.toHaveBeenCalled();
    expect(mockScrollToEnd).not.toHaveBeenCalled();
    followTail.mockRestore();
  });

  it('does not jump when the loading chrome height changes while scrolled up', async () => {
    const { rerender, coordinator } = renderFeed();
    await flushRaf();

    const el = screen.getByTestId('chatroom-timeline-scroll');
    const chrome = el.firstElementChild as HTMLElement;
    Object.defineProperty(chrome, 'offsetHeight', { configurable: true, value: 32 });
    scrollElProps(el, 300, 2500);

    await waitFor(() => {
      expect(coordinator.current.getAllowLoadOlder()).toBe(true);
    });

    act(() => {
      scrollElProps(el, 300, 2500);
      el.dispatchEvent(new Event('scroll'));
    });

    const scrollTopBeforeSpinner = el.scrollTop;
    mockScrollToEnd.mockClear();

    Object.defineProperty(chrome, 'offsetHeight', { configurable: true, value: 56 });
    timelineIsLoadingOlder = true;

    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(el.scrollTop).toBe(scrollTopBeforeSpinner + 24);
    expect(mockScrollToEnd).not.toHaveBeenCalled();
  });
});
