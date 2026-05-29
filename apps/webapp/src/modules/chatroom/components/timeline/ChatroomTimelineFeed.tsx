'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import { useChatroomTimeline } from '../../hooks/useChatroomTimeline';
import { useScrollController } from '../../hooks/useScrollController';

import { TimelineEventRow } from './TimelineEventRow';
import type { MachineNameEntry } from './timelineRowStyles';
import {
  getTimelineItemKey,
  TIMELINE_ESTIMATE_SIZE,
  TIMELINE_LOAD_OLDER_INDEX_THRESHOLD,
  TIMELINE_OVERSCAN,
  TIMELINE_PURGE_INDEX_THRESHOLD,
} from './timelineVirtualizerConfig';

export interface ChatroomTimelineFeedProps {
  chatroomId: string;
  machines?: Map<string, MachineNameEntry>;
}

export const ChatroomTimelineFeed = memo(function ChatroomTimelineFeed({
  chatroomId,
  machines,
}: ChatroomTimelineFeedProps) {
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const prevEventCountRef = useRef(0);
  const wasLoadingOlderRef = useRef(false);
  const loadAnchorIdRef = useRef<string | null>(null);
  const hasInitialScrollRef = useRef(false);

  const { controller, isPinned, scrollToBottom } = useScrollController();

  const {
    events,
    isLoading,
    hasMoreOlder,
    isLoadingOlder,
    loadOlderEvents,
    purgeOldMessages,
  } = useChatroomTimeline(chatroomId);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => TIMELINE_ESTIMATE_SIZE,
    overscan: TIMELINE_OVERSCAN,
    getItemKey: (index) => getTimelineItemKey(index, events),
  });

  const scrollRefCallback = useCallback(
    (node: HTMLDivElement | null) => {
      scrollParentRef.current = node;
      if (node) {
        controller.current.attach(node);
      } else {
        controller.current.detach();
      }
    },
    [controller]
  );

  const scrollToLatest = useCallback(() => {
    if (events.length === 0) return;
    virtualizer.scrollToIndex(events.length - 1, { align: 'end' });
    controller.current.scrollToBottom();
  }, [controller, events.length, virtualizer]);

  // Bottom-pinned on first data paint
  useLayoutEffect(() => {
    if (events.length > 0 && !hasInitialScrollRef.current) {
      hasInitialScrollRef.current = true;
      scrollToLatest();
    }
  }, [events.length, scrollToLatest]);

  // Snap to bottom when new events arrive while pinned
  useLayoutEffect(() => {
    const prevCount = prevEventCountRef.current;
    const added = events.length > prevCount;

    if (added && isPinned && !wasLoadingOlderRef.current) {
      scrollToLatest();
    }

    // Restore scroll anchor after prepending older events
    if (added && wasLoadingOlderRef.current && loadAnchorIdRef.current) {
      const anchorIndex = events.findIndex((e) => e.id === loadAnchorIdRef.current);
      if (anchorIndex >= 0) {
        virtualizer.scrollToIndex(anchorIndex, { align: 'start' });
      }
      loadAnchorIdRef.current = null;
    }

    prevEventCountRef.current = events.length;
    wasLoadingOlderRef.current = isLoadingOlder;
  }, [events, isLoadingOlder, isPinned, scrollToLatest, virtualizer]);

  useEffect(() => {
    wasLoadingOlderRef.current = isLoadingOlder;
  }, [isLoadingOlder]);

  const tryLoadOlder = useCallback(() => {
    if (!hasMoreOlder || isLoadingOlder) return;
    const firstVisible = virtualizer.getVirtualItems()[0];
    if (firstVisible) {
      loadAnchorIdRef.current = events[firstVisible.index]?.id ?? null;
    }
    loadOlderEvents();
  }, [events, hasMoreOlder, isLoadingOlder, loadOlderEvents, virtualizer]);

  // Load older when scrolled near the top of the list
  useEffect(() => {
    const firstVisible = virtualizer.getVirtualItems()[0];
    if (!firstVisible) return;
    if (firstVisible.index <= TIMELINE_LOAD_OLDER_INDEX_THRESHOLD) {
      tryLoadOlder();
    }
  }, [tryLoadOlder, virtualizer.range, virtualizer]);

  const handleScroll = useCallback(() => {
    const firstVisible = virtualizer.getVirtualItems()[0];
    if (!firstVisible) return;

    if (firstVisible.index <= TIMELINE_LOAD_OLDER_INDEX_THRESHOLD) {
      tryLoadOlder();
    }

    if (controller.current.isPinned && firstVisible.index > TIMELINE_PURGE_INDEX_THRESHOLD) {
      purgeOldMessages(firstVisible.index);
    }
  }, [controller, purgeOldMessages, tryLoadOlder, virtualizer]);

  // Fill short viewports by loading until scrollable or exhausted
  useEffect(() => {
    const el = scrollParentRef.current;
    if (!el || !hasMoreOlder || isLoadingOlder) return;
    if (el.scrollHeight <= el.clientHeight) {
      tryLoadOlder();
    }
  }, [events.length, hasMoreOlder, isLoadingOlder, tryLoadOlder]);

  if (isLoading && events.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="flex flex-col items-center justify-center h-full text-chatroom-text-muted">
          <div className="w-8 h-8 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="flex flex-col items-center justify-center h-full text-chatroom-text-muted">
          <MessageSquare size={32} className="mb-4" />
          <div>No messages yet</div>
          <div className="text-muted-foreground mt-2">Send a message to get started</div>
        </div>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const canLoadMore = hasMoreOlder && !isLoadingOlder;

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div
        ref={scrollRefCallback}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain min-h-0 scrollbar-thin scrollbar-track-chatroom-bg-primary scrollbar-thumb-chatroom-border"
        data-testid="chatroom-timeline-scroll"
      >
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
                <TimelineEventRow event={event} machines={machines} />
              </div>
            );
          })}
        </div>
      </div>

      {!isPinned && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-chatroom-accent text-chatroom-text-on-accent shadow-lg hover:bg-chatroom-accent/90 transition-all"
          aria-label="Jump to new messages"
        >
          <ChevronDown size={16} />
          <span className="text-xs font-medium">Jump to new messages</span>
        </button>
      )}
    </div>
  );
});
