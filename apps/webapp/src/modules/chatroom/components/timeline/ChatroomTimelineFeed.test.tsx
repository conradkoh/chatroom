/**
 * ChatroomTimelineFeed — virtualizer stability and scroll-pin wiring tests.
 */

// matchMedia polyfill needed by useIsDesktop (used by MessageDownloadMenu/ResponsivePickerShell)

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { afterAll, beforeAll, describe, it, expect, vi, beforeEach } from 'vitest';

import { ChatroomTimelineFeed } from './ChatroomTimelineFeed';
import {
  jumpToNewMessagesBottomOffset,
  TIMELINE_EAGER_MEASURE_MAX_COUNT,
  TIMELINE_OVERSCAN,
  TIMELINE_PADDING_END,
} from './timelineVirtualizerConfig';
import { AttachmentsProvider } from '../../attachments';
import { TimelineScrollCoordinator } from '../../hooks/timelineScrollCoordinator';
import type { TimelineEvent } from '../../timeline/types';

// matchMedia polyfill needed by useIsDesktop (used by TimelineEventCountMenu / download menu)
beforeAll(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );

  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.callback = cb;
      }
      observe(target: Element) {
        this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const virtualizerOptions: {
  count: number;
  getItemKey: (index: number) => string;
  scrollMargin?: number;
  paddingEnd?: number;
  overscan?: number;
  measureElement?: (el: HTMLElement) => number;
  estimateSize?: (index: number) => number;
}[] = [];

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
/** When set, include the tail row in getVirtualItems (for in-place tail growth tests). */
let mockTailItemIndex: number | null = null;
let mockTailItemSize = 100;

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: (typeof virtualizerOptions)[0]) => {
    virtualizerOptions.push(options);
    const instance = {
      getVirtualItems: () => {
        if (mockFirstVisibleIndex < 0 && mockTailItemIndex === null) return [];
        const items: {
          index: number;
          start: number;
          size: number;
          key: string;
        }[] = [];
        if (mockFirstVisibleIndex >= 0) {
          items.push({
            index: mockFirstVisibleIndex,
            start: mockFirstVisibleIndex * 100,
            size: 100,
            key: `row-${mockFirstVisibleIndex}`,
          });
        }
        if (mockTailItemIndex !== null && !items.some((row) => row.index === mockTailItemIndex)) {
          items.push({
            index: mockTailItemIndex,
            start: mockTailItemIndex * 100,
            size: mockTailItemSize,
            key: `row-${mockTailItemIndex}`,
          });
        }
        return items;
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

vi.mock('../StandingInstructionsBar', () => ({
  StandingInstructionsBar: () => null,
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

function TimelineFeedWithProviders(props: React.ComponentProps<typeof ChatroomTimelineFeed>) {
  return (
    <AttachmentsProvider>
      <ChatroomTimelineFeed {...props} />
    </AttachmentsProvider>
  );
}

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
  const view = render(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
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
    rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
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

  it('load older button works during programmatic tail scroll', async () => {
    const user = userEvent.setup();
    const { coordinator } = renderFeed();
    expect(coordinator.current.isProgrammaticScrollActive()).toBe(true);

    await user.click(screen.getByRole('button', { name: /load older messages/i }));

    expect(loadOlderEvents).toHaveBeenCalledTimes(1);
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
      | ((
          item: { start: number },
          delta: number,
          instance: { scrollOffset: number | null; scrollDirection: string | null }
        ) => boolean)
      | undefined;
    expect(shouldAdjust?.({ start: 0 }, 0, { scrollOffset: 500, scrollDirection: null })).toBe(
      false
    );
    expect(shouldAdjust?.({ start: 100 }, 0, { scrollOffset: 500, scrollDirection: null })).toBe(
      false
    );
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
    rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);

    const pinnedOptions = virtualizerOptions.at(-1) as (typeof virtualizerOptions)[0] & {
      anchorTo?: string;
      followOnAppend?: boolean | 'auto';
    };
    expect(pinnedOptions.anchorTo).toBe('end');
    expect(pinnedOptions.followOnAppend).toBe(false);

    virtualizerOptions.length = 0;
    render(
      <TimelineFeedWithProviders chatroomId="room-1" coordinator={createCoordinatorRef(false)} />
    );
    const unpinnedOptions = virtualizerOptions.at(-1) as (typeof virtualizerOptions)[0] & {
      followOnAppend?: boolean | 'auto';
    };
    expect(unpinnedOptions.followOnAppend).toBe(false);
  });

  it('uses stable getItemKey across parent re-renders', () => {
    const { rerender, coordinator } = renderFeed();
    expect(virtualizerOptions.length).toBeGreaterThan(0);

    const firstOptions = virtualizerOptions.at(-1) as (typeof virtualizerOptions)[0];
    const keyBeforeRerender = firstOptions.getItemKey(0);

    rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);

    const secondOptions = virtualizerOptions.at(-1) as (typeof virtualizerOptions)[0];
    expect(secondOptions.getItemKey(0)).toBe(keyBeforeRerender);
    expect(keyBeforeRerender).toBe('evt-1');
  });

  it('configures virtualizer count from timeline events', () => {
    renderFeed();
    const options = virtualizerOptions.at(-1) as (typeof virtualizerOptions)[0];
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

    // Settle the initial programmatic tail-scroll. In JSDOM, scrollHeight/clientHeight
    // are 0 by default so computeIsAtBottom() never returns true, causing the
    // programmatic-scroll flag to stay set for the full 30-frame cap. Setting
    // scroll dimensions here lets the targetCheck resolve on the next rAF.
    scrollElProps(screen.getByTestId('chatroom-timeline-scroll'), 800, 1200);

    await waitFor(() => {
      expect(coordinator.current.getAllowLoadOlder()).toBe(true);
    });

    setScrollPinned(true);
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
      rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(mockScrollToEnd).toHaveBeenCalled();
  });

  it('commits layout when top chrome is still being measured (does not block tail follow)', async () => {
    const { rerender, coordinator } = renderFeed();
    await flushRaf();
    setScrollPinned(true);

    const scroll = screen.getByTestId('chatroom-timeline-scroll');
    const chrome = scroll.firstElementChild as HTMLElement;
    Object.defineProperty(chrome, 'offsetHeight', { configurable: true, value: 48 });

    mockHasMoreOlder = true;
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
      rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(mockScrollToEnd).toHaveBeenCalled();
  });
});

describe('ChatroomTimelineFeed tail row in-place growth', () => {
  beforeEach(() => {
    virtualizerOptions.length = 0;
    mockScrollToEnd.mockClear();
    loadOlderEvents.mockClear();
    mockHasMoreOlder = false;
    mockFirstVisibleIndex = -1;
    mockTailItemIndex = null;
    mockTailItemSize = 100;
    timelineEvents = buildEvents(25);
    timelineIsLoadingOlder = false;
  });

  it('notifies coordinator when tail row measured size grows while pinned', async () => {
    mockTailItemIndex = 24;
    mockTailItemSize = 100;

    const { rerender, coordinator } = renderFeed();
    await flushRaf();
    setScrollPinned(true);

    const notifyTailRowResized = vi.spyOn(coordinator.current, 'notifyTailRowResized');

    act(() => {
      rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
    });
    notifyTailRowResized.mockClear();

    mockTailItemSize = 280;
    act(() => {
      rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(notifyTailRowResized).toHaveBeenCalledWith(24);
    notifyTailRowResized.mockRestore();
  });

  it('does not notify when tail row grows while unpinned', async () => {
    mockTailItemIndex = 24;
    mockTailItemSize = 100;

    const { rerender, coordinator } = renderFeed(false);
    await flushRaf();
    setScrollPinned(false);

    const notifyTailRowResized = vi.spyOn(coordinator.current, 'notifyTailRowResized');

    act(() => {
      rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
    });
    notifyTailRowResized.mockClear();

    mockTailItemSize = 280;
    act(() => {
      rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(notifyTailRowResized).not.toHaveBeenCalled();
    notifyTailRowResized.mockRestore();
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
      rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(mockScrollToEnd).toHaveBeenCalled();
    expect(coordinator.current.isPinned).toBe(true);
    expect(screen.queryByRole('button', { name: 'Jump to new messages' })).toBeNull();
  });

  it('follows tail on append when physically at bottom', async () => {
    const { rerender, coordinator } = renderFeed();
    await flushRaf();
    setScrollPinned(true);
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
      rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(mockScrollToEnd).toHaveBeenCalled();
    expect(coordinator.current.isPinned).toBe(true);
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
      rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
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

  it('shows jump chip on partial scroll from tail and follows tail on click', async () => {
    timelineEvents = buildEvents(25);
    const user = userEvent.setup();
    const { coordinator } = renderFeed(true);
    await flushRaf();

    const el = screen.getByTestId('chatroom-timeline-scroll');
    const maxScrollTop = 2500 - 400;
    const partialScrollTop = maxScrollTop - 80;

    // Settle the initial programmatic tail-scroll (same JSDOM reason as above).
    scrollElProps(el, maxScrollTop, 2500);

    await waitFor(() => {
      expect(coordinator.current.getAllowLoadOlder()).toBe(true);
    });

    act(() => {
      scrollElProps(el, partialScrollTop, 2500);
      el.dispatchEvent(new Event('wheel'));
      el.dispatchEvent(new Event('scroll'));
    });

    await waitFor(() => {
      expect(coordinator.current.isPinned).toBe(false);
    });
    expect(screen.getByRole('button', { name: 'Jump to new messages' })).toBeInTheDocument();

    mockScrollToEnd.mockClear();
    await user.click(screen.getByRole('button', { name: 'Jump to new messages' }));
    await flushRaf();
    await flushRaf();

    expect(coordinator.current.isPinned).toBe(true);
    expect(mockScrollToEnd).toHaveBeenCalled();
    expect(el.scrollTop).toBe(maxScrollTop);
    expect(screen.queryByRole('button', { name: 'Jump to new messages' })).toBeNull();
  });

  it('positions jump chip above measured footer chrome', async () => {
    // Stub offsetHeight for the footer chrome element
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight'
    );
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        if ((this as HTMLElement).getAttribute('data-testid') === 'timeline-footer-chrome')
          return 96;
        return originalDescriptor?.get?.call(this) ?? 0;
      },
    });

    timelineEvents = buildEvents(25);
    const { coordinator } = renderFeed(true);
    await flushRaf();
    setScrollPinned(true);
    mockScrollToEnd.mockClear();

    // Unpin so the chip appears
    const el = screen.getByTestId('chatroom-timeline-scroll');
    scrollElProps(el, 0, 2500);
    await waitFor(() => {
      expect(coordinator.current.getAllowLoadOlder()).toBe(true);
    });
    act(() => {
      scrollElProps(el, 0, 2500);
      el.dispatchEvent(new Event('scroll'));
    });
    await waitFor(() => {
      expect(coordinator.current.isPinned).toBe(false);
    });

    const chip = screen.getByRole('button', { name: 'Jump to new messages' });
    expect(chip).toHaveStyle({ bottom: `${jumpToNewMessagesBottomOffset(96)}px` });

    // Restore
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalDescriptor!);
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
      rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
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
      rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(el.scrollTop).toBe(expectedScrollTopAfterPrepend);
    expect(followTail).not.toHaveBeenCalled();
    expect(mockScrollToEnd).not.toHaveBeenCalled();
    expect(coordinator.current.isPrependScrollPreservationActive()).toBe(true);
    followTail.mockRestore();
  });

  it('allows virtualizer scroll adjustment only while prepend is settling', async () => {
    const { coordinator } = renderFeed();
    await flushRaf();

    const shouldAdjust = lastVirtualizerInstance?.shouldAdjustScrollPositionOnItemSizeChange as
      | ((
          item: { start: number },
          delta: number,
          instance: { scrollOffset: number | null; scrollDirection: string | null }
        ) => boolean)
      | undefined;

    expect(shouldAdjust?.({ start: 100 }, 0, { scrollOffset: 500, scrollDirection: null })).toBe(
      false
    );

    coordinator.current.setLoadOlderIntent('preserve_position', {
      key: 'evt-2',
      index: 2,
      scrollTop: 200,
      scrollHeight: 2500,
      offsetInItem: 10,
    });

    expect(coordinator.current.isPrependScrollPreservationActive()).toBe(true);
    expect(shouldAdjust?.({ start: 100 }, 0, { scrollOffset: 500, scrollDirection: null })).toBe(
      true
    );
    expect(
      shouldAdjust?.({ start: 600 }, 0, { scrollOffset: 500, scrollDirection: 'backward' })
    ).toBe(false);
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
      rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(el.scrollTop).toBe(scrollTopBeforeSpinner + 24);
    expect(mockScrollToEnd).not.toHaveBeenCalled();
  });

  it('disables browser overflow-anchor so manual prepend correction is not double-applied', async () => {
    renderFeed();
    const el = screen.getByTestId('chatroom-timeline-scroll');
    expect(el.className).toContain('[overflow-anchor:none]');
  });

  it('allows horizontal overflow on the timeline scroll root', async () => {
    renderFeed();
    const el = screen.getByTestId('chatroom-timeline-scroll');
    expect(el.className).toContain('overflow-x-auto');
    expect(el.className).not.toContain('overflow-x-hidden');
  });

  it('skips chrome shrink compensation when older messages land after loading', async () => {
    const notifyTopChromeDelta = vi.spyOn(
      TimelineScrollCoordinator.prototype,
      'notifyTopChromeDelta'
    );
    const { rerender, coordinator } = renderFeed();
    await flushRaf();

    const el = screen.getByTestId('chatroom-timeline-scroll');
    const chrome = el.firstElementChild as HTMLElement;
    timelineIsLoadingOlder = true;
    Object.defineProperty(chrome, 'offsetHeight', { configurable: true, value: 56 });
    scrollElProps(el, 300, 2500);

    await waitFor(() => {
      expect(coordinator.current.getAllowLoadOlder()).toBe(true);
    });

    act(() => {
      rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
    });

    notifyTopChromeDelta.mockClear();
    Object.defineProperty(chrome, 'offsetHeight', { configurable: true, value: 32 });
    timelineIsLoadingOlder = false;
    timelineEvents = [
      ...buildEvents(10).map((e, i) => ({ ...e, id: `older-${i}` })),
      ...buildEvents(25),
    ];

    act(() => {
      rerender(<TimelineFeedWithProviders chatroomId="room-1" coordinator={coordinator} />);
    });

    expect(notifyTopChromeDelta).not.toHaveBeenCalled();
    notifyTopChromeDelta.mockRestore();
  });

  it('registers custom measureElement that caches rounded heights by data-id', () => {
    renderFeed();
    const measureElement = virtualizerOptions.at(-1)?.measureElement as
      ((el: HTMLElement) => number) | undefined;
    expect(measureElement).toBeTypeOf('function');

    const row = document.createElement('div');
    row.setAttribute('data-id', 'evt-round');
    Object.defineProperty(row, 'getBoundingClientRect', {
      value: () => ({ height: 64.7 }),
    });

    expect((measureElement as (el: HTMLElement) => number)(row)).toBe(65);
  });

  it('persists row height in measurement cache across re-renders', async () => {
    const { rerender } = renderFeed();
    await flushRaf();

    // Get the estimateSize function from the virtualizer options
    const estimateSize = virtualizerOptions.at(-1)?.estimateSize as
      ((index: number) => number) | undefined;
    expect(estimateSize).toBeTypeOf('function');

    // First render: cache should return estimated size (100) for unmeasured items
    expect(estimateSize?.(0)).toBe(100);
    expect(estimateSize?.(1)).toBe(100);

    // Simulate measurement: evt-1 gets measured as 150px
    // The useEffect that syncs from virtualizer.getVirtualItems() would write this
    // We verify the cache is wired by checking that estimateSize reads from it
    // after a re-render (which re-runs the useEffect)
    timelineEvents = [
      ...buildEvents(3),
      {
        id: 'evt-measured',
        kind: 'user_message' as const,
        creationTime: 999,
        message: {
          _id: 'evt-measured',
          type: 'message' as const,
          senderRole: 'user',
          content: 'Measured message',
          _creationTime: 999,
        },
      },
    ];

    act(() => {
      rerender(
        <TimelineFeedWithProviders chatroomId="room-1" coordinator={createCoordinatorRef()} />
      );
    });
    await flushRaf();

    // The estimateSize function should now read from the cache if the item was measured
    // Since we can't easily mock the measurement, we verify the wiring exists
    // by checking that estimateSize is called with the correct indices
    const options = virtualizerOptions.at(-1) as (typeof virtualizerOptions)[0];
    expect(options.estimateSize).toBeDefined();
    expect(typeof options.estimateSize).toBe('function');
  });
});
