'use client';

import { useEffect, useRef } from 'react';

import { TimelineEventRow } from '../../components/timeline/TimelineEventRow';
import {
  TIMELINE_SCROLL_CONTAINER,
  TIMELINE_SCROLL_CONTAINER_STYLE,
} from '../../components/timeline/timelineRowStyles';
import type { MachineNameEntry } from '../../components/timeline/timelineRowStyles';
import type { TimelineEvent } from '../../timeline/types';

export function AllTabMessageList({
  events,
  machines,
  anchorId,
}: {
  events: TimelineEvent[];
  machines?: Map<string, MachineNameEntry>;
  anchorId: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

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
      className={`flex-1 ${TIMELINE_SCROLL_CONTAINER}`}
      style={TIMELINE_SCROLL_CONTAINER_STYLE}
      data-testid="all-tab-message-list"
    >
      {events.map((event) => (
        <TimelineEventRow key={event.id} event={event} chatroomId="" machines={machines} />
      ))}
    </div>
  );
}
