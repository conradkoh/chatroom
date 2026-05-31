'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useSessionQuery, useSessionId } from 'convex-helpers/react/sessions';
import { usePaginatedQuery } from 'convex/react';
import { ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';
import type React from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { useChatroomTimeline } from '../../hooks/useChatroomTimeline';
import { useHandoffNotification } from '../../hooks/useHandoffNotification';
import type { PrependScrollAnchor, TimelineScrollCoordinator } from '../../hooks/timelineScrollCoordinator';
import type { EventStreamEvent } from '../../viewModels/eventStreamViewModel';

import { EventStreamModal } from '../EventStreamModal';
import { QueuedMessagesIndicator } from '../QueuedMessagesIndicator';

import { TimelineEventRow } from './TimelineEventRow';
import { TimelineLatestEventTicker } from './TimelineLatestEventTicker';
import type { MachineNameEntry } from './timelineRowStyles';
import {
  getTimelineItemKey,
  shouldTriggerLoadOlder,
  TIMELINE_EAGER_MEASURE_MAX_COUNT,
  TIMELINE_ESTIMATE_SIZE,
  TIMELINE_OVERSCAN,
  TIMELINE_PADDING_END,
  TIMELINE_SCROLL_END_THRESHOLD,
} from './timelineVirtualizerConfig';

function timelineOverscan(eventCount: number): number {
  if (eventCount <= TIMELINE_EAGER_MEASURE_MAX_COUNT) {
    return Math.max(TIMELINE_OVERSCAN, eventCount);
  }
  return TIMELINE_OVERSCAN;
}

export interface ChatroomTimelineFeedProps {
  chatroomId: string;
  coordinator: React.MutableRefObject<TimelineScrollCoordinator>;
  onRegisterOpenEventStream?: (openFn: () => void) => void;
  machines?: Map<string, MachineNameEntry>;
}

export function ChatroomTimelineFeed({
  chatroomId,
  coordinator,
  onRegisterOpenEventStream,
  machines,
}: ChatroomTimelineFeedProps) {
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const topChromeRef = useRef<HTMLDivElement>(null);
  const [topChromeHeight, setTopChromeHeight] = useState(0);
  const [isEventStreamOpen, setIsEventStreamOpen] = useState(false);

  const isPinned = useSyncExternalStore(
    (onStoreChange) => coordinator.current.subscribe(onStoreChange),
    () => coordinator.current.getSnapshot(),
    () => coordinator.current.getSnapshot()
  );

  const { events, isLoading, hasMoreOlder, isLoadingOlder, loadOlderEvents } =
    useChatroomTimeline(chatroomId);

  const messagesForNotify = useMemo(() => events.map((e) => e.message), [events]);
  useHandoffNotification(messagesForNotify, chatroomId);

  useEffect(() => {
    onRegisterOpenEventStream?.(() => setIsEventStreamOpen(true));
  }, [onRegisterOpenEventStream]);

  const latestEventTicker = useSessionQuery(api.events.listLatestEvents, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    limit: 1,
  });

  const [eventSessionId] = useSessionId();
  const eventsPaginated = usePaginatedQuery(
    api.events.listLatestEventsPaginated,
    isEventStreamOpen && eventSessionId
      ? { chatroomId: chatroomId as Id<'chatroom_rooms'>, sessionId: eventSessionId }
      : 'skip',
    { initialNumItems: 20 }
  );

  const latestEvent: EventStreamEvent | null =
    (latestEventTicker as EventStreamEvent[] | undefined)?.[0] ?? null;

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => TIMELINE_ESTIMATE_SIZE,
    overscan: timelineOverscan(events.length),
    scrollMargin: topChromeHeight,
    paddingEnd: TIMELINE_PADDING_END,
    getItemKey: (index) => getTimelineItemKey(index, events),
    anchorTo: 'end',
    // Tail follow when pinned is handled imperatively in TimelineScrollCoordinator
    // (commitTimelineLayout / followTail). Toggling followOnAppend on pin/unpin
    // reconfigures TanStack Virtual and causes a visible scroll jump.
    followOnAppend: false,
    scrollEndThreshold: TIMELINE_SCROLL_END_THRESHOLD,
  });
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    if (!coordinator.current.isPrependScrollPreservationActive()) {
      return false;
    }
    const scrollOffset = instance.scrollOffset ?? 0;
    return item.start < scrollOffset && instance.scrollDirection !== 'backward';
  };
  const eagerMeasureDoneRef = useRef(false);

  const scrollRefCallback = useCallback(
    (node: HTMLDivElement | null) => {
      scrollParentRef.current = node;
      if (node) {
        coordinator.current.attach(node);
      } else {
        coordinator.current.detach();
      }
    },
    [coordinator]
  );

  const canLoadMore = hasMoreOlder && !isLoadingOlder;
  const tailEventKey = events.length > 0 ? events[events.length - 1]!.id : null;

  useEffect(() => {
    coordinator.current.syncIsLoadingOlder(isLoadingOlder);
  }, [coordinator, isLoadingOlder]);

  useLayoutEffect(() => {
    const measuredChrome = topChromeRef.current?.offsetHeight ?? 0;
    if (measuredChrome === topChromeHeight) return;

    const el = scrollParentRef.current;
    const chromeDelta = measuredChrome - topChromeHeight;
    // Preserve viewport when top chrome grows (load-older spinner); skip only at tail.
    if (el && chromeDelta !== 0 && !coordinator.current.isAtBottom()) {
      el.scrollTop += chromeDelta;
      virtualizerRef.current.scrollToOffset(el.scrollTop, { behavior: 'auto' });
    }
    setTopChromeHeight(measuredChrome);
  });

  useLayoutEffect(() => {
    coordinator.current.setVirtualizer({
      scrollToEnd: (options) => virtualizerRef.current.scrollToEnd(options),
      scrollToIndex: (index, options) => virtualizerRef.current.scrollToIndex(index, options),
      scrollToOffset: (offset, options) => virtualizerRef.current.scrollToOffset(offset, options),
      findIndexForKey: (key) => {
        const index = events.findIndex((event) => event.id === key);
        return index >= 0 ? index : null;
      },
      getItemStart: (index) => {
        const visible = virtualizerRef.current
          .getVirtualItems()
          .find((row) => row.index === index);
        if (visible) return visible.start;
        return topChromeHeight + index * TIMELINE_ESTIMATE_SIZE;
      },
      getVisibleCount: () => virtualizerRef.current.getVirtualItems().length,
    });

    coordinator.current.commitTimelineLayout({
      scrollEl: scrollParentRef.current,
      eventCount: events.length,
      tailKey: tailEventKey,
      isLoadingOlder,
    });
  }, [coordinator, events, isLoadingOlder, tailEventKey, topChromeHeight]);

  const tryLoadOlder = useCallback(
    (intent: 'preserve_position' | 'fill_viewport' = 'preserve_position') => {
      if (!coordinator.current.getAllowLoadOlder() || !hasMoreOlder || isLoadingOlder) return;
      const el = scrollParentRef.current;
      const firstVisible = virtualizer.getVirtualItems()[0];
      let anchor: PrependScrollAnchor | undefined;
      if (intent === 'preserve_position' && el && firstVisible) {
        const anchoredEvent = events[firstVisible.index];
        if (anchoredEvent) {
          anchor = {
            key: anchoredEvent.id,
            index: firstVisible.index,
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            offsetInItem: el.scrollTop - firstVisible.start + topChromeHeight,
          };
        }
      }
      coordinator.current.setLoadOlderIntent(intent, anchor);
      loadOlderEvents();
    },
    [coordinator, events, hasMoreOlder, isLoadingOlder, loadOlderEvents, virtualizer]
  );

  const handleScroll = useCallback(() => {
    if (!coordinator.current.getAllowLoadOlder()) return;
    if (coordinator.current.isProgrammaticScrollActive()) return;

    const el = scrollParentRef.current;
    const firstVisible = virtualizer.getVirtualItems()[0];
    if (!el || !firstVisible) return;

    if (
      shouldTriggerLoadOlder({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        firstVisibleIndex: firstVisible.index,
        topChromeHeight,
      })
    ) {
      tryLoadOlder('preserve_position');
    }
  }, [coordinator, topChromeHeight, tryLoadOlder, virtualizer]);

  const virtualizedContentHeight = virtualizer.getTotalSize();

  useEffect(() => {
    if (eagerMeasureDoneRef.current || events.length === 0) return;
    if (events.length > TIMELINE_EAGER_MEASURE_MAX_COUNT) {
      eagerMeasureDoneRef.current = true;
      return;
    }

    let frames = 0;
    const maxFrames = 8;

    const tick = (): void => {
      if (!coordinator.current.getAllowLoadOlder()) {
        if (frames++ < maxFrames * 4) {
          requestAnimationFrame(tick);
        }
        return;
      }

      if (!coordinator.current.isPinned) {
        eagerMeasureDoneRef.current = true;
        return;
      }

      const el = scrollParentRef.current;
      if (!el) {
        eagerMeasureDoneRef.current = true;
        return;
      }

      el.querySelectorAll('[data-index]').forEach((node) => {
        virtualizerRef.current.measureElement(node as HTMLElement);
      });

      frames++;
      if (frames >= maxFrames) {
        if (coordinator.current.isPinned && coordinator.current.isAtBottom()) {
          coordinator.current.followTail('auto');
        }
        eagerMeasureDoneRef.current = true;
        return;
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }, [coordinator, events.length]);

  useEffect(() => {
    if (!coordinator.current.getAllowLoadOlder() || !isPinned) return;

    const el = scrollParentRef.current;
    if (!el || !hasMoreOlder || isLoadingOlder) return;

    const contentHeight = topChromeHeight + virtualizedContentHeight;
    if (contentHeight <= el.clientHeight) {
      tryLoadOlder('fill_viewport');
    }
  }, [
    coordinator,
    events.length,
    hasMoreOlder,
    isLoadingOlder,
    isPinned,
    topChromeHeight,
    tryLoadOlder,
    virtualizedContentHeight,
  ]);

  const footer = (
    <>
      <EventStreamModal
        isOpen={isEventStreamOpen}
        onClose={() => setIsEventStreamOpen(false)}
        events={(eventsPaginated.results as EventStreamEvent[] | undefined) ?? []}
        isLoading={
          isEventStreamOpen &&
          (eventsPaginated.results === undefined ||
            eventsPaginated.status === 'LoadingFirstPage')
        }
        onLoadMore={() => eventsPaginated.loadMore(20)}
        hasMore={eventsPaginated.status === 'CanLoadMore'}
        machines={machines}
      />
      <QueuedMessagesIndicator chatroomId={chatroomId as Id<'chatroom_rooms'>} />
      <div className="flex items-center justify-between px-4 py-2 bg-chatroom-bg-surface border-t-2 border-chatroom-border-strong">
        <TimelineLatestEventTicker
          key={latestEvent?._id}
          event={latestEvent}
          onClick={() => setIsEventStreamOpen((prev) => !prev)}
        />
        <span className="flex-shrink-0 text-[10px] text-chatroom-text-muted tabular-nums font-mono">
          {events.length} EVENTS
        </span>
      </div>
    </>
  );

  if (isLoading && events.length === 0) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          <div className="flex flex-col items-center justify-center h-full text-chatroom-text-muted">
            <div className="w-8 h-8 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
          </div>
        </div>
        {footer}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          <div className="flex flex-col items-center justify-center h-full text-chatroom-text-muted">
            <MessageSquare size={32} className="mb-4" />
            <div>No messages yet</div>
            <div className="text-chatroom-text-muted mt-2">Send a message to get started</div>
          </div>
        </div>
        {footer}
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div
        ref={scrollRefCallback}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain min-h-0 [overflow-anchor:auto] scrollbar-thin scrollbar-track-chatroom-bg-primary scrollbar-thumb-chatroom-border"
        data-testid="chatroom-timeline-scroll"
      >
        <div ref={topChromeRef}>
          {canLoadMore && (
            <button
              type="button"
              onClick={() => tryLoadOlder('preserve_position')}
              className="w-full py-2 text-[10px] text-chatroom-text-muted flex items-center justify-center gap-1 hover:text-chatroom-text-primary transition-colors"
            >
              <ChevronUp size={12} />
              Load older messages
            </button>
          )}
          {!hasMoreOlder && (
            <div className="w-full py-2 text-[10px] text-chatroom-text-muted flex items-center justify-center">
              Beginning of conversation
            </div>
          )}
          {isLoadingOlder && (
            <div className="w-full py-2 text-sm text-chatroom-text-muted flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
              Loading...
            </div>
          )}
        </div>

        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map((virtualRow) => {
            const event = events[virtualRow.index];
            if (!event) return null;
            return (
              <div
                key={event.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <TimelineEventRow event={event} chatroomId={chatroomId} machines={machines} />
              </div>
            );
          })}
        </div>
      </div>

      {!isPinned && (
        <button
          type="button"
          onClick={() => coordinator.current.jumpToEnd('smooth')}
          className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-chatroom-accent text-chatroom-text-on-accent shadow-lg hover:bg-chatroom-accent/90 transition-all"
          aria-label="Jump to new messages"
        >
          <ChevronDown size={16} />
          <span className="text-xs font-medium">Jump to new messages</span>
        </button>
      )}

      {footer}
    </div>
  );
}
