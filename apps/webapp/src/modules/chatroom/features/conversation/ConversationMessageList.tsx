'use client';

// fallow-ignore-file complexity

import { ChevronDown } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { TimelineEventRow } from '../../components/timeline/TimelineEventRow';
import {
  getTimelineVirtualRowZIndex,
  TIMELINE_SCROLL_CONTAINER,
  TIMELINE_SCROLL_CONTAINER_STYLE,
} from '../../components/timeline/timelineRowStyles';
import type { TimelineMessageHeaderNavigation } from '../../components/timeline/timelineRowStyles';
import {
  JUMP_TO_NEW_MESSAGES_GAP_PX,
  JUMP_TO_NEW_MESSAGES_Z_INDEX,
} from '../../components/timeline/timelineVirtualizerConfig';
import { useScrollController } from '../../hooks/useScrollController';
import type { TimelineEvent } from '../../timeline/types';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

const LOAD_MORE_THRESHOLD = 120;

type JumpTarget = 'first' | 'previous' | 'current' | 'next' | 'last';

function scrollRowToTop(container: HTMLElement, row: HTMLElement): void {
  const top =
    row.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  container.scrollTo({ top, behavior: 'smooth' });
}

/**
 * Memoized timeline row.
 *
 * `headerNavigation` used to be built inline per row in the parent's render,
 * which handed every row a new object and defeated `memo` on
 * `TimelineEventRow`/`TimelineTeamMessage` — so every Convex update re-rendered
 * the whole feed. Building it here (memoized on index/bounds/onJump) keeps row
 * props stable across updates that change other rows only.
 */
const ConversationRow = memo(function ConversationRow({
  event,
  index,
  isFirst,
  isLast,
  onJump,
}: {
  event: TimelineEvent;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onJump: (index: number, target: JumpTarget) => void;
}) {
  const headerNavigation = useMemo<TimelineMessageHeaderNavigation>(
    () => ({
      onJumpToFirst: () => onJump(index, 'first'),
      onJumpToPrevious: () => onJump(index, 'previous'),
      onJumpToCurrent: () => onJump(index, 'current'),
      onJumpToNext: () => onJump(index, 'next'),
      onJumpToLast: () => onJump(index, 'last'),
      hasFirst: !isFirst,
      hasPrevious: !isFirst,
      hasNext: !isLast,
      hasLast: !isLast,
    }),
    [index, isFirst, isLast, onJump]
  );

  return (
    <div
      data-message-id={event.id}
      style={{ position: 'relative', zIndex: getTimelineVirtualRowZIndex(index) }}
    >
      <TimelineEventRow event={event} chatroomId="" headerNavigation={headerNavigation} />
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

  const scrollToMessageTop = useCallback((messageId: string) => {
    const el = containerRef.current;
    if (!el) return;
    const row = el.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!row) return;
    scrollRowToTop(el, row);
  }, []);

  // Latest events for the stable jump callback below. A ref keeps `onJump`
  // identity stable so memoized rows are not invalidated by every append.
  const eventsRef = useRef(events);
  useLayoutEffect(() => {
    eventsRef.current = events;
  }, [events]);

  const onJump = useCallback(
    (index: number, target: JumpTarget) => {
      const list = eventsRef.current;
      const targetIndex = {
        first: 0,
        previous: index - 1,
        current: index,
        next: index + 1,
        last: list.length - 1,
      }[target];
      const event = list[targetIndex];
      if (event) scrollToMessageTop(event.id);
    },
    [scrollToMessageTop]
  );

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
        className={`relative z-0 flex-1 ${TIMELINE_SCROLL_CONTAINER}`}
        style={TIMELINE_SCROLL_CONTAINER_STYLE}
        data-testid="conversation-message-list"
      >
        {events.map((event, index) => (
          <ConversationRow
            key={event.id}
            event={event}
            index={index}
            isFirst={index === 0}
            isLast={index === events.length - 1}
            onJump={onJump}
          />
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
    </div>
  );
}
