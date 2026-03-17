'use client';

import { Activity } from 'lucide-react';
import { memo } from 'react';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

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
  const role = 'role' in event ? (event as { role?: string }).role : undefined;
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-chatroom-border last:border-b-0 hover:bg-chatroom-bg-hover transition-colors">
      {/* Type badge */}
      <span
        className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${getBadgeStyle(event.type)}`}
      >
        {formatEventType(event.type)}
      </span>
      {/* Role */}
      {role && (
        <span className="flex-shrink-0 text-[10px] font-medium text-chatroom-text-secondary">
          {role}
        </span>
      )}
      {/* Timestamp — pushed right */}
      <span className="ml-auto flex-shrink-0 text-[10px] text-chatroom-text-muted tabular-nums font-mono">
        {formatTimestamp(timestamp)}
      </span>
    </div>
  );
});

// ─── Event Stream Modal ───────────────────────────────────────────────────────

interface EventStreamModalProps {
  isOpen: boolean;
  onClose: () => void;
  events: EventStreamEvent[];
  onLoadMore?: () => void;
  hasMore?: boolean;
}

export const EventStreamModal = memo(function EventStreamModal({
  isOpen,
  onClose,
  events,
  onLoadMore,
  hasMore,
}: EventStreamModalProps) {
  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-2xl">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <FixedModalTitle className="flex items-center gap-2">
            <Activity size={14} className="text-chatroom-status-info" />
            Event Stream
          </FixedModalTitle>
        </FixedModalHeader>
        <FixedModalBody>
          {/* Section header — for future extensibility (tabs, filters, etc.) */}
          <div className="px-4 py-2 border-b border-chatroom-border bg-chatroom-bg-tertiary">
            <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
              Latest Events
            </span>
          </div>
          {events.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-chatroom-text-muted">
              <span className="text-xs">No events yet</span>
            </div>
          ) : (
            events.map((event) => <EventRow key={event._id} event={event} />)
          )}
          {/* Load more button */}
          {hasMore && onLoadMore && (
            <button
              onClick={onLoadMore}
              className="w-full py-2 text-xs text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
            >
              Load more events
            </button>
          )}
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
