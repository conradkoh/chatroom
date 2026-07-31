'use client';

import { useCallback, useEffect, useRef } from 'react';

import { TimelineEventRow } from '../../components/timeline/TimelineEventRow';
import {
  getTimelineVirtualRowZIndex,
  TIMELINE_SCROLL_CONTAINER,
  TIMELINE_SCROLL_CONTAINER_STYLE,
} from '../../components/timeline/timelineRowStyles';
import type { MachineNameEntry } from '../../components/timeline/timelineRowStyles';
import type { TimelineEvent } from '../../timeline/types';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

export function AllTabMessageList({
  events,
  machines,
  anchorId,
  canLoadMore,
  isLoadingMore,
  onLoadMore,
}: {
  events: TimelineEvent[];
  machines?: Map<string, MachineNameEntry>;
  anchorId: string | null;
  canLoadMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // fallow-ignore-next-line complexity
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || !canLoadMore || isLoadingMore || !onLoadMore) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) onLoadMore();
  }, [canLoadMore, isLoadingMore, onLoadMore]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = 0;
    }
  }, [anchorId]);

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
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`flex-1 ${TIMELINE_SCROLL_CONTAINER}`}
      style={TIMELINE_SCROLL_CONTAINER_STYLE}
      data-testid="all-tab-message-list"
    >
      {events.map((event, index) => (
        <div
          key={event.id}
          style={{ position: 'relative', zIndex: getTimelineVirtualRowZIndex(index) }}
        >
          <TimelineEventRow event={event} chatroomId="" machines={machines} />
        </div>
      ))}
      {isLoadingMore && (
        <div className="py-2 flex justify-center" data-testid="all-tab-loading-more">
          <ChatroomLoader size="sm" />
        </div>
      )}
    </div>
  );
}
