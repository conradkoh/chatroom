'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useSessionQuery, useSessionId } from 'convex-helpers/react/sessions';
import { usePaginatedQuery } from 'convex/react';
import { ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';
import {
  memo,
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
import { useTimelineScroll } from '../../hooks/useTimelineScroll';
import type { EventStreamEvent } from '../../viewModels/eventStreamViewModel';

import { EventStreamModal } from '../EventStreamModal';
import { QueuedMessagesIndicator } from '../QueuedMessagesIndicator';

import { TimelineEventRow } from './TimelineEventRow';
import { TimelineLatestEventTicker } from './TimelineLatestEventTicker';
import type { MachineNameEntry } from './timelineRowStyles';
import {
  estimateTimelineRowSize,
  getTimelineItemKey,
  shouldTriggerLoadOlder,
  TIMELINE_PADDING_END,
  timelineOverscan,
} from './timelineVirtualizerConfig';

export interface ChatroomTimelineFeedProps {
  chatroomId: string;
  onRegisterOpenEventStream?: (openFn: () => void) => void;
  machines?: Map<string, MachineNameEntry>;
}

export const ChatroomTimelineFeed = memo(function ChatroomTimelineFeed({
  chatroomId,
  onRegisterOpenEventStream,
  machines,
}: ChatroomTimelineFeedProps) {
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const topChromeRef = useRef<HTMLDivElement>(null);
  const [topChromeHeight, setTopChromeHeight] = useState(0);
  const [isEventStreamOpen, setIsEventStreamOpen] = useState(false);

  const scroll = useTimelineScroll();
  const isPinned = useSyncExternalStore(scroll.subscribe, scroll.getSnapshot, scroll.getSnapshot);

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

  const tailEventId = events.length > 0 ? events[events.length - 1]!.id : null;

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: (index) => estimateTimelineRowSize(events[index]),
    overscan: timelineOverscan(events.length),
    scrollMargin: topChromeHeight,
    paddingEnd: TIMELINE_PADDING_END,
    getItemKey: (index) => getTimelineItemKey(index, events),
    anchorTo: 'end',
    followOnAppend: isPinned ? 'auto' : false,
  });

  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    if (!scroll.isPendingPrepend()) return false;
    return item.start < (instance.scrollOffset ?? 0);
  };

  const scrollRefCallback = useCallback(
    (node: HTMLDivElement | null) => {
      scrollParentRef.current = node;
      if (!node) return;
      const detach = scroll.attach(node);
      scroll.setVirtualizer({ scrollToEnd: (o) => virtualizer.scrollToEnd(o) });
      return () => {
        detach();
        scroll.setVirtualizer(null);
      };
    },
    [scroll, virtualizer]
  );

  const canLoadMore = hasMoreOlder && !isLoadingOlder;

  useLayoutEffect(() => {
    const height = topChromeRef.current?.offsetHeight ?? 0;
    setTopChromeHeight((prev) => (prev === height ? prev : height));
  }, [canLoadMore, hasMoreOlder, isLoadingOlder]);

  useLayoutEffect(() => {
    scroll.commit({ eventCount: events.length, tailEventId, isLoadingOlder });
  }, [scroll, events.length, tailEventId, isLoadingOlder]);

  const tryLoadOlder = useCallback(() => {
    if (!hasMoreOlder || isLoadingOlder) return;
    scroll.beginLoadOlder();
    loadOlderEvents();
  }, [hasMoreOlder, isLoadingOlder, loadOlderEvents, scroll]);

  const handleScroll = useCallback(() => {
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
      tryLoadOlder();
    }
  }, [topChromeHeight, tryLoadOlder, virtualizer]);

  useEffect(() => {
    if (!isPinned || !hasMoreOlder || isLoadingOlder) return;
    const el = scrollParentRef.current;
    if (!el) return;
    if (topChromeHeight + virtualizer.getTotalSize() <= el.clientHeight) {
      tryLoadOlder();
    }
  }, [
    events.length,
    hasMoreOlder,
    isLoadingOlder,
    isPinned,
    topChromeHeight,
    tryLoadOlder,
    virtualizer,
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
              onClick={tryLoadOlder}
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

        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualItems.map((virtualRow) => {
            const event = events[virtualRow.index];
            if (!event) return null;
            const rowEstimate = estimateTimelineRowSize(event);
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
                  contain: 'layout paint',
                  contentVisibility: 'auto',
                  containIntrinsicSize: `${rowEstimate}px ${rowEstimate}px`,
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
          onClick={scroll.jumpToEnd}
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
});
