'use client';

import { useEffect, useRef } from 'react';

import { TimelineEventRow } from '../../components/timeline/TimelineEventRow';
import type { TimelineEvent } from '../../timeline/types';
import type { MachineNameEntry } from '../../components/timeline/timelineRowStyles';

export function AllTabMessageList({
  events,
  isOnLatestAnchor,
  machines,
}: {
  events: TimelineEvent[];
  isOnLatestAnchor: boolean;
  machines?: Map<string, MachineNameEntry>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevEventCountRef = useRef(events.length);

  useEffect(() => {
    if (isOnLatestAnchor && events.length > prevEventCountRef.current) {
      const el = containerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
    prevEventCountRef.current = events.length;
  }, [events.length, isOnLatestAnchor]);

  if (events.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center text-chatroom-text-muted text-sm"
      >
        No messages yet
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto" data-testid="all-tab-message-list">
      {events.map((event) => (
        <TimelineEventRow key={event.id} event={event} chatroomId="" machines={machines} />
      ))}
    </div>
  );
}
