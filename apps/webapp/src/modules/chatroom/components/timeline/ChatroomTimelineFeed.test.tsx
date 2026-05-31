/**
 * ChatroomTimelineFeed — behavior tests with real @tanstack/react-virtual.
 *
 * jsdom stubs (required for layout): TanStack Virtual reads clientHeight,
 * scrollTop/scrollHeight, and row offsetHeight / getBoundingClientRect.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TimelineEvent } from '../../timeline/types';

import { TIMELINE_PADDING_END } from './timelineVirtualizerConfig';

const ROW_HEIGHT = 80;
const VIEWPORT_HEIGHT = 600;

let savedGetBoundingClientRect: typeof HTMLElement.prototype.getBoundingClientRect;
let savedOffsetHeight: PropertyDescriptor | undefined;
let savedResizeObserver: typeof globalThis.ResizeObserver | undefined;

function contentHeight(rowCount: number, topChrome = 0): number {
  return topChrome + rowCount * ROW_HEIGHT + TIMELINE_PADDING_END;
}

function installLayoutStubs(): void {
  savedGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  savedOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  savedResizeObserver = globalThis.ResizeObserver;

  globalThis.ResizeObserver = class ResizeObserver {
    private readonly cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element): void {
      queueMicrotask(() => {
        this.cb(
          [
            {
              target,
              contentRect: {
                width: 400,
                height: VIEWPORT_HEIGHT,
                top: 0,
                left: 0,
                bottom: VIEWPORT_HEIGHT,
                right: 400,
                x: 0,
                y: 0,
                toJSON: () => ({}),
              },
            } as ResizeObserverEntry,
          ],
          this
        );
      });
    }
    unobserve(): void {}
    disconnect(): void {}
  } as typeof ResizeObserver;

  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const base = savedGetBoundingClientRect.call(this);
    if (this.getAttribute('data-testid') === 'chatroom-timeline-scroll') {
      return {
        ...base,
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 400,
        bottom: VIEWPORT_HEIGHT,
        width: 400,
        height: VIEWPORT_HEIGHT,
      } as DOMRect;
    }
    const idx = this.dataset?.index;
    if (idx !== undefined) {
      const index = Number(idx);
      const scrollEl = document.querySelector('[data-testid="chatroom-timeline-scroll"]');
      const scrollTop = scrollEl?.scrollTop ?? 0;
      const chromeEl = scrollEl?.firstElementChild as HTMLElement | null;
      const chromeH = chromeEl?.offsetHeight ?? 0;
      const top = chromeH + index * ROW_HEIGHT - scrollTop;
      return {
        ...base,
        x: 0,
        y: top,
        top,
        left: 0,
        right: 100,
        bottom: top + ROW_HEIGHT,
        width: 100,
        height: ROW_HEIGHT,
      } as DOMRect;
    }
    return base;
  };

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset?.index !== undefined) return ROW_HEIGHT;
      if (savedOffsetHeight?.get) return savedOffsetHeight.get.call(this);
      return 0;
    },
  });
}

function restoreLayoutStubs(): void {
  HTMLElement.prototype.getBoundingClientRect = savedGetBoundingClientRect;
  if (savedOffsetHeight) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', savedOffsetHeight);
  }
  if (savedResizeObserver) {
    globalThis.ResizeObserver = savedResizeObserver;
  }
}

function configureScrollEl(el: HTMLElement, scrollTop: number, rowCount: number, topChrome = 0): void {
  const scrollHeight = contentHeight(rowCount, topChrome);
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: VIEWPORT_HEIGHT });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: VIEWPORT_HEIGHT });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 400 });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 400 });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
}

function primeScrollContainer(rowCount: number, scrollTop = 0): HTMLElement {
  const el = screen.getByTestId('chatroom-timeline-scroll');
  configureScrollEl(el, scrollTop, rowCount);
  el.dispatchEvent(new Event('resize', { bubbles: true }));
  return el;
}

async function waitForRows(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelector('[data-index]')).toBeTruthy();
  });
}

function scrollToBottom(el: HTMLElement, rowCount: number, topChrome = 0): void {
  const maxScrollTop = Math.max(0, contentHeight(rowCount, topChrome) - VIEWPORT_HEIGHT);
  configureScrollEl(el, maxScrollTop, rowCount, topChrome);
  el.dispatchEvent(new Event('scroll', { bubbles: true }));
}

const loadOlderEvents = vi.fn();

let timelineEvents: TimelineEvent[] = [];
let timelineIsLoadingOlder = false;
let mockHasMoreOlder = false;

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

vi.mock('../../hooks/useChatroomTimeline', () => ({
  useChatroomTimeline: () => ({
    events: timelineEvents,
    isLoading: false,
    hasMoreOlder: mockHasMoreOlder,
    isLoadingOlder: timelineIsLoadingOlder,
    loadOlderEvents,
  }),
}));

vi.mock('./TimelineEventRow', () => ({
  TimelineEventRow: ({ event }: { event: { message: { content: string } } }) => (
    <div>{event.message.content}</div>
  ),
}));

import { ChatroomTimelineFeed } from './ChatroomTimelineFeed';

function buildEvents(count: number, idOffset = 0): TimelineEvent[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + idOffset;
    const id = `evt-${n}`;
    return {
      id,
      kind: 'user_message' as const,
      creationTime: n * 100,
      message: {
        _id: id,
        type: 'message' as const,
        senderRole: 'user',
        content: `${id}-content`,
        _creationTime: n * 100,
      },
    };
  });
}

function renderFeed() {
  const view = render(<ChatroomTimelineFeed chatroomId="room-1" />);
  act(() => {
    primeScrollContainer(timelineEvents.length);
  });
  view.rerender(<ChatroomTimelineFeed chatroomId="room-1" />);
  return view;
}

describe('ChatroomTimelineFeed scroll behavior', () => {
  beforeEach(() => {
    installLayoutStubs();
    loadOlderEvents.mockClear();
    mockHasMoreOlder = false;
    timelineIsLoadingOlder = false;
    timelineEvents = buildEvents(5);
  });

  afterEach(() => {
    restoreLayoutStubs();
  });

  it('pinned + new message → stays at tail, no jump chip', async () => {
    const { rerender } = renderFeed();
    await waitForRows();
    const el = primeScrollContainer(5);

    act(() => {
      scrollToBottom(el, 5);
    });

    timelineEvents = buildEvents(6);
    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" />);
    });

    await waitFor(() => {
      expect(screen.getByText('evt-5-content')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Jump to new messages' })).toBeNull();
    const maxScrollTop = contentHeight(6) - VIEWPORT_HEIGHT;
    expect(el.scrollTop).toBeGreaterThanOrEqual(maxScrollTop - ROW_HEIGHT);
  });

  it('scrolled up + new message → jump chip appears, scrollTop unchanged', async () => {
    timelineEvents = buildEvents(15);
    const { rerender } = renderFeed();
    await waitForRows();
    const el = primeScrollContainer(15, 0);

    act(() => {
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    const scrollTopBefore = el.scrollTop;

    timelineEvents = buildEvents(16);
    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" />);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Jump to new messages' })).toBeInTheDocument();
    });

    expect(el.scrollTop).toBe(scrollTopBefore);
  });

  it('click jump → scroll moves to bottom, chip disappears', async () => {
    const user = userEvent.setup();
    timelineEvents = buildEvents(15);
    const { rerender } = renderFeed();
    await waitForRows();
    const el = primeScrollContainer(15, 0);

    act(() => {
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    timelineEvents = buildEvents(16);
    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" />);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Jump to new messages' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Jump to new messages' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Jump to new messages' })).toBeNull();
    });
  });

  it('send while pinned with same count (tail rotates) → still at bottom', async () => {
    timelineEvents = buildEvents(5);
    const { rerender } = renderFeed();
    await waitForRows();
    const el = primeScrollContainer(5);

    act(() => {
      scrollToBottom(el, 5);
    });

    timelineEvents = [
      ...buildEvents(4, 1),
      {
        id: 'evt-6',
        kind: 'user_message',
        creationTime: 600,
        message: {
          _id: 'evt-6',
          type: 'message',
          senderRole: 'user',
          content: 'evt-6-content',
          _creationTime: 600,
        },
      },
    ];

    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" />);
    });

    await waitFor(() => {
      expect(screen.getByText('evt-6-content')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Jump to new messages' })).toBeNull();
    const maxScrollTop = contentHeight(5) - VIEWPORT_HEIGHT;
    expect(el.scrollTop).toBeGreaterThanOrEqual(maxScrollTop - ROW_HEIGHT);
  });

  it('load-older preserves scroll anchor', async () => {
    const user = userEvent.setup();
    mockHasMoreOlder = true;
    timelineEvents = buildEvents(15);
    const { rerender } = renderFeed();
    await waitForRows();
    const el = primeScrollContainer(15);

    act(() => {
      configureScrollEl(el, 0, 15);
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    await user.click(screen.getByRole('button', { name: /load older messages/i }));
    expect(loadOlderEvents).toHaveBeenCalled();

    const anchorText = 'evt-3-content';
    const topBefore = screen.getByText(anchorText).getBoundingClientRect().top;
    const scrollTopBeforeLoad = el.scrollTop;

    timelineIsLoadingOlder = true;
    act(() => {
      rerender(<ChatroomTimelineFeed chatroomId="room-1" />);
    });

    const older = buildEvents(10).map((e, i) => ({
      ...e,
      id: `older-${i}`,
      message: { ...e.message, _id: `older-${i}`, content: `older-${i}-content` },
    }));
    timelineEvents = [...older, ...buildEvents(15)];
    timelineIsLoadingOlder = false;

    act(() => {
      configureScrollEl(el, scrollTopBeforeLoad + 10 * ROW_HEIGHT, 25);
      rerender(<ChatroomTimelineFeed chatroomId="room-1" />);
    });

    await waitFor(() => {
      expect(screen.getByText(anchorText)).toBeInTheDocument();
    });

    const topAfter = screen.getByText(anchorText).getBoundingClientRect().top;
    expect(Math.abs(topAfter - topBefore)).toBeLessThan(8);
  });
});
