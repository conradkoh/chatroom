'use client';

import React, { memo, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import {
  type EventStreamEvent,
  formatEventType,
  formatTimestamp,
} from '../viewModels/eventStreamViewModel';

// ─── Event type badge color mapping ──────────────────────────────────────────

function getBadgeStyle(type: string): string {
  if (type.startsWith('agent.')) {
    return 'bg-chatroom-status-info/15 text-chatroom-status-info';
  }
  if (type.startsWith('task.')) {
    return 'bg-chatroom-status-success/15 text-chatroom-status-success';
  }
  if (type.startsWith('skill.')) {
    return 'bg-chatroom-status-purple/15 text-chatroom-status-purple';
  }
  if (type.startsWith('daemon.')) {
    return 'bg-chatroom-text-muted/15 text-chatroom-text-muted';
  }
  return 'bg-chatroom-text-muted/15 text-chatroom-text-muted';
}

// ─── Event row ────────────────────────────────────────────────────────────────

interface EventRowProps {
  event: EventStreamEvent;
}

const EventRow = memo(function EventRow({ event }: EventRowProps) {
  const timestamp = event.timestamp ?? event._creationTime;
  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-chatroom-border last:border-b-0 hover:bg-chatroom-bg-hover transition-colors">
      {/* Type badge */}
      <span
        className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${getBadgeStyle(event.type)}`}
      >
        {formatEventType(event.type)}
      </span>
      {/* Role */}
      {event.role && (
        <span className="flex-shrink-0 text-[10px] font-medium text-chatroom-text-secondary">
          {event.role}
        </span>
      )}
      {/* Timestamp — pushed right */}
      <span className="ml-auto flex-shrink-0 text-[10px] text-chatroom-text-muted tabular-nums">
        {formatTimestamp(timestamp)}
      </span>
    </div>
  );
});

// ─── Main panel ───────────────────────────────────────────────────────────────

interface EventStreamPanelProps {
  events: EventStreamEvent[];
  onClose: () => void;
}

export const EventStreamPanel = memo(function EventStreamPanel({
  events,
  onClose,
}: EventStreamPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full left-0 right-0 z-50 bg-chatroom-bg-surface border-2 border-chatroom-border-strong shadow-lg"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-chatroom-border-strong bg-chatroom-bg-tertiary">
        <span className="text-[11px] font-bold uppercase tracking-wider text-chatroom-text-secondary">
          Event Stream
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
          aria-label="Close event stream"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-72 overflow-y-auto">
        {events.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-chatroom-text-muted">
            No events yet
          </div>
        ) : (
          events.map((event) => (
            <EventRow key={event._id} event={event} />
          ))
        )}
      </div>
    </div>
  );
});
