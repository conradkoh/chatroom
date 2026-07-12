'use client';

import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
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

import type {
  PrependScrollAnchor,
  TimelineScrollCoordinator,
} from '../../hooks/timelineScrollCoordinator';
import { useChatroomTimelineFeedData } from '../../hooks/useChatroomTimelineFeedData';
import type { EventStreamEvent } from '../../viewModels/eventStreamViewModel';
import { EventStreamModal } from '../EventStreamModal';
import { QueuedMessagesIndicator } from '../QueuedMessagesIndicator';
import { TimelineEventRow } from './TimelineEventRow';
import { TimelineLatestEventTicker } from './TimelineLatestEventTicker';
import { logLoadOlder } from './timelineLoadOlderDebug';
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

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

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
  onRegisterMessageStoreActions?: (actions: {
    removeMessagesForTask: (taskId: string) => void;
  }) => void;
  machines?: Map<string, MachineNameEntry>;
}

export function ChatroomTimelineFeed({
  chatroomId,
  coordinator,
  onRegisterOpenEventStream,
  onRegisterMessageStoreActions,
  machines,
}: ChatroomTimelineFeedProps) {
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const topChromeRef = useRef<HTMLDivElement>(null);
  const [topChromeHeight, setTopChromeHeight] = useState(0);
  const measurementCacheRef = useRef<Map<string, number>>(new Map());
  const tailMeasureRef = useRef<{ id: string; size: number } | null>(null);
  const prevEventCountRef = useRef(0);
  const prevIsLoadingOlderRef = useRef(false);

  const {
    events,
    isLoading,
    hasMoreOlder,
    isLoadingOlder,
    loadOlderEvents,
    removeMessagesForTask,
    isEventStreamOpen,
    setIsEventStreamOpen,
    latestEvent,
    eventsPaginated,
  } = useChatroomTimelineFeedData(chatroomId);

  const isPinned = useSyncExternalStore(
    (onStoreChange) => coordinator.current.subscribe(onStoreChange),
    () => coordinator.current.getSnapshot(),
    () => coordinator.current.getSnapshot()
  );

  const prevChatroomIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevChatroomIdRef.current !== null && prevChatroomIdRef.current !== chatroomId) {
      coordinator.current.resetForChatroom();
    }
    prevChatroomIdRef.current = chatroomId;
  }, [chatroomId, coordinator]);

  useEffect(() => {
    onRegisterOpenEventStream?.(() => setIsEventStreamOpen(true));
  }, [onRegisterOpenEventStream, setIsEventStreamOpen]);

  useEffect(() => {
    onRegisterMessageStoreActions?.({ removeMessagesForTask });
  }, [onRegisterMessageStoreActions, removeMessagesForTask]);

  const initialMeasurementsCache = useMemo((): VirtualItem[] => {
    // Snapshot the cache once at mount. Re-mounts (chatroom switch) re-create.
    return events.map((event, index) => ({
      key: event.id,
      index,
      size: measurementCacheRef.current.get(event.id) ?? TIMELINE_ESTIMATE_SIZE,
      start: 0,
      end: 0,
      lane: 0,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: (index) => {
      const event = events[index];
      if (!event) return TIMELINE_ESTIMATE_SIZE;
      return measurementCacheRef.current.get(event.id) ?? TIMELINE_ESTIMATE_SIZE;
    },
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
    initialMeasurementsCache,
    measureElement: (el) => {
      const id = el.getAttribute('data-id');
      const height = Math.round(el.getBoundingClientRect().height);
      if (id && height > 0) {
        measurementCacheRef.current.set(id, height);
      }
      return height;
    },
  });
  useEffect(() => {
    const cache = measurementCacheRef.current;
    for (const item of virtualizer.getVirtualItems()) {
      const e = events[item.index];
      if (e && item.size > 0) cache.set(e.id, item.size);
    }

    const lastEvent = events.at(-1) ?? null;
    if (!lastEvent) {
      tailMeasureRef.current = null;
      return;
    }

    const measuredSize = cache.get(lastEvent.id);
    if (measuredSize === undefined || measuredSize <= 0) return;

    const prev = tailMeasureRef.current;
    if (
      prev?.id === lastEvent.id &&
      measuredSize > prev.size &&
      coordinator.current.shouldFollowTail()
    ) {
      coordinator.current.notifyTailRowResized(events.length - 1);
    }
    tailMeasureRef.current = { id: lastEvent.id, size: measuredSize };
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
  const tailEventKey = events.at(-1)?.id ?? null;

  useEffect(() => {
    coordinator.current.syncIsLoadingOlder(isLoadingOlder);
  }, [coordinator, isLoadingOlder]);

  // Prepend preserve must run before top-chrome measurement on the same layout pass.
  // Otherwise spinner removal shrinks scrollMargin first and the viewport jumps before
  // height-delta correction runs (guide §6a + §6b).
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
        const visible = virtualizerRef.current.getVirtualItems().find((row) => row.index === index);
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

  useLayoutEffect(() => {
    const measuredChrome = topChromeRef.current?.offsetHeight ?? 0;
    if (measuredChrome === topChromeHeight) return;

    const chromeDelta = measuredChrome - topChromeHeight;
    const eventsPrepended =
      events.length > prevEventCountRef.current && prevIsLoadingOlderRef.current && !isLoadingOlder;
    const skipChromeDelta =
      chromeDelta < 0 &&
      (coordinator.current.isPrependScrollPreservationActive() || eventsPrepended);
    if (chromeDelta !== 0 && !skipChromeDelta) {
      coordinator.current.notifyTopChromeDelta(chromeDelta);
    }
    setTopChromeHeight(measuredChrome);
    prevEventCountRef.current = events.length;
    prevIsLoadingOlderRef.current = isLoadingOlder;
  });

  const tryLoadOlder = useCallback(
    (
      intent: 'preserve_position' | 'fill_viewport' = 'preserve_position',
      options: { userInitiated?: boolean } = {}
    ) => {
      const userInitiated = options.userInitiated ?? false;
      const programmaticScroll = coordinator.current.isProgrammaticScrollActive();
      const blockedReason = !hasMoreOlder
        ? 'hasMoreOlder=false'
        : isLoadingOlder
          ? 'isLoadingOlder=true'
          : !userInitiated && programmaticScroll
            ? 'programmaticScroll=true'
            : null;

      logLoadOlder('tryLoadOlder', {
        intent,
        userInitiated,
        programmaticScroll,
        hasMoreOlder,
        isLoadingOlder,
        eventCount: events.length,
        blockedReason,
      });

      if (blockedReason) return;

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
      logLoadOlder('invoke loadOlderEvents', { intent, anchorKey: anchor?.key ?? null });
      loadOlderEvents();
    },
    [
      coordinator,
      events,
      hasMoreOlder,
      isLoadingOlder,
      loadOlderEvents,
      topChromeHeight,
      virtualizer,
    ]
  );

  const handleScroll = useCallback(() => {
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
    if (coordinator.current.isProgrammaticScrollActive() || !isPinned) return;

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
          (eventsPaginated.results === undefined || eventsPaginated.status === 'LoadingFirstPage')
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
            <ChatroomLoader size="md" />
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
        className="flex-1 overflow-y-auto overflow-x-auto overscroll-contain min-h-0 [overflow-anchor:none] scrollbar-thin scrollbar-track-chatroom-bg-primary scrollbar-thumb-chatroom-border"
        data-testid="chatroom-timeline-scroll"
      >
        <div ref={topChromeRef}>
          {canLoadMore && (
            <button
              type="button"
              onClick={() => tryLoadOlder('preserve_position', { userInitiated: true })}
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
              <ChatroomLoader size="sm" />
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
                key={virtualRow.key}
                data-index={virtualRow.index}
                data-id={event.id}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: virtualRow.start,
                  left: 0,
                  width: '100%',
                  contain: 'layout style',
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
          onClick={() => coordinator.current.jumpToEnd()}
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
