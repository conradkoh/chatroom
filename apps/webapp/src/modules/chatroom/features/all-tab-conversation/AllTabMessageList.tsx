'use client';

import { useEffect, useRef } from 'react';

import { TimelineEventRow } from '../../components/timeline/TimelineEventRow';
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
