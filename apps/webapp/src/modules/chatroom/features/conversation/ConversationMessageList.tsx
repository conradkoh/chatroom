'use client';

// fallow-ignore-file complexity

import { ChevronDown } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { ConversationJumpToTopButton } from './ConversationJumpToTopButton';
import { useJumpToTop } from './hooks/useJumpToTop';
import { TimelineEventRow } from '../../components/timeline/TimelineEventRow';
import {
  getTimelineVirtualRowZIndex,
  TIMELINE_SCROLL_CONTAINER,
  TIMELINE_SCROLL_CONTAINER_STYLE,
} from '../../components/timeline/timelineRowStyles';
import {
  JUMP_TO_NEW_MESSAGES_GAP_PX,
  JUMP_TO_NEW_MESSAGES_Z_INDEX,
} from '../../components/timeline/timelineVirtualizerConfig';
import { useScrollController } from '../../hooks/useScrollController';
import type { TimelineEvent } from '../../timeline/types';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

const LOAD_MORE_THRESHOLD = 120;

/**
 * Memoized timeline row. Its props are only the event and its index, so an append
 * (which leaves existing events and indexes unchanged) re-renders only the new row.
 */
const ConversationRow = memo(function ConversationRow({
  event,
  index,
}: {
  event: TimelineEvent;
  index: number;
}) {
  return (
    <div
      data-message-id={event.id}
      style={{ position: 'relative', zIndex: getTimelineVirtualRowZIndex(index) }}
    >
      <TimelineEventRow event={event} chatroomId="" />
    </div>
  );
});

export function ConversationMessageList({
  events,
  anchorId,
  canLoadMore,
  isLoadingMore,
  onLoadMore,
}: {
  events: TimelineEvent[];
  anchorId: string | null;
  canLoadMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const { controller, isPinned, scrollToBottom } = useScrollController();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef(0);
  const prevEventCountRef = useRef(0);
  const wasLoadingMoreRef = useRef(false);

  useEffect(() => {
    wasLoadingMoreRef.current = !!isLoadingMore;
  }, [isLoadingMore]);

  const containerRefCallback = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      if (node) controller.current.attach(node);
      else controller.current.detach();
    },
    [controller]
  );

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || !canLoadMore || isLoadingMore || !onLoadMore) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_THRESHOLD;
    if (nearBottom) onLoadMore();
  }, [canLoadMore, isLoadingMore, onLoadMore]);

  const {
    isVisible: isJumpToTopVisible,
    jumpToTop,
    pause: pauseJumpToTop,
    resume: resumeJumpToTop,
  } = useJumpToTop({
    containerRef,
    enabled: events.length > 0,
    resetKey: anchorId,
  });

  // Anchor change → scroll to top + sync pin (dispatch scroll so controller unpins)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
    prevScrollHeightRef.current = el.scrollHeight;
    prevEventCountRef.current = events.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorId]);

  // Tail follow when pinned + content grows at bottom
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const newScrollHeight = el.scrollHeight;
    const heightDiff = newScrollHeight - prevScrollHeightRef.current;
    const eventsAdded = events.length > prevEventCountRef.current;
    if (eventsAdded && heightDiff > 0 && prevScrollHeightRef.current > 0) {
      controller.current.onNewMessages(heightDiff, wasLoadingMoreRef.current, false);
    }
    prevScrollHeightRef.current = newScrollHeight;
    prevEventCountRef.current = events.length;
  }, [events.length, controller]);

  if (events.length === 0) {
    return (
      <div
        ref={containerRef}
        className={`flex-1 ${TIMELINE_SCROLL_CONTAINER} flex items-center justify-center text-chatroom-text-muted text-sm`}
        style={TIMELINE_SCROLL_CONTAINER_STYLE}
      >
        No messages yet
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={containerRefCallback}
        onScroll={handleScroll}
        tabIndex={-1}
        className={`relative z-0 flex-1 focus:outline-none ${TIMELINE_SCROLL_CONTAINER}`}
        style={TIMELINE_SCROLL_CONTAINER_STYLE}
        data-testid="conversation-message-list"
      >
        {events.map((event, index) => (
          <ConversationRow key={event.id} event={event} index={index} />
        ))}
        {isLoadingMore && (
          <div className="py-2 flex justify-center" data-testid="conversation-loading-more">
            <ChatroomLoader size="sm" />
          </div>
        )}
      </div>

      {!isPinned && events.length > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          style={{ bottom: JUMP_TO_NEW_MESSAGES_GAP_PX, zIndex: JUMP_TO_NEW_MESSAGES_Z_INDEX }}
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 bg-chatroom-accent text-chatroom-text-on-accent shadow-lg hover:bg-chatroom-accent/90 transition-all"
          aria-label="Jump to new messages"
          data-testid="conversation-jump-to-new-messages"
        >
          <ChevronDown size={16} />
          <span className="text-xs font-medium">Jump to new messages</span>
        </button>
      )}

      {isJumpToTopVisible && (
        <ConversationJumpToTopButton
          onClick={jumpToTop}
          onPause={pauseJumpToTop}
          onResume={resumeJumpToTop}
        />
      )}
    </div>
  );
}
