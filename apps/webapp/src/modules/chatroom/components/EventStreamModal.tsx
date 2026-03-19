'use client';

import { Activity } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

import {
  getEventTypeDefinition,
  initializeEventTypes,
  PlaceholderEventDetails,
  PlaceholderEventRow,
} from '../eventTypes';
import type { EventStreamEvent } from '../viewModels/eventStreamViewModel';

// Initialize event type registry once at module load
initializeEventTypes();

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
  // Track selected event for detail view
  const [selectedEvent, setSelectedEvent] = useState<EventStreamEvent | null>(null);

  // Ref for the scrollable event list container
  const eventListRef = useRef<HTMLDivElement>(null);
  // Snapshot of scrollTop before loading more, used to restore scroll position
  const prevScrollTopRef = useRef<number | null>(null);
  // Track the event count when load-more was triggered to detect the actual data change
  const prevEventCountRef = useRef<number | null>(null);

  // Auto-select first event when events change
  useEffect(() => {
    if (events.length > 0 && !selectedEvent) {
      setSelectedEvent(events[0]);
    }
  }, [events, selectedEvent]);

  // Reset selection when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedEvent(null);
    }
  }, [isOpen]);

  // Sync selection with events list (when first event changes)
  useEffect(() => {
    if (events.length > 0) {
      setSelectedEvent((current) => {
        // Keep current selection if it's still in the list
        if (current && events.some((e) => e._id === current._id)) {
          return current;
        }
        // Otherwise select first event
        return events[0];
      });
    } else {
      setSelectedEvent(null);
    }
  }, [events]);

  // Restore scroll position after new events are appended (load more).
  // Events are sorted newest-first, so "load more" appends older events at the bottom.
  // We save scrollTop before the load and restore it once the new data actually arrives
  // (detected by the event count changing), preventing any React re-render scroll reset.
  useEffect(() => {
    const container = eventListRef.current;
    const savedScrollTop = prevScrollTopRef.current;
    const savedEventCount = prevEventCountRef.current;
    if (container && savedScrollTop !== null && savedEventCount !== null) {
      // Only restore once the event count has actually changed (new data arrived)
      if (events.length !== savedEventCount) {
        container.scrollTop = savedScrollTop;
        prevScrollTopRef.current = null;
        prevEventCountRef.current = null;
      }
    }
  }, [events]);

  // Wrap onLoadMore to snapshot scroll state before triggering load
  const handleLoadMore = useCallback(() => {
    if (!onLoadMore) return;
    const container = eventListRef.current;
    if (container) {
      prevScrollTopRef.current = container.scrollTop;
      prevEventCountRef.current = events.length;
    }
    onLoadMore();
  }, [onLoadMore, events.length]);

  // Render event row using the registry
  const renderEventRow = (event: EventStreamEvent) => {
    const isSelected = selectedEvent?._id === event._id;
    const timestamp = event.timestamp ?? event._creationTime;
    const definition = getEventTypeDefinition(event.type);

    if (definition) {
      return (
        <div key={event._id} onClick={() => setSelectedEvent(event)} className="cursor-pointer">
          {definition.cellRenderer(event as never, isSelected)}
        </div>
      );
    }

    return (
      <PlaceholderEventRow
        key={event._id}
        type={event.type}
        timestamp={timestamp}
        isSelected={isSelected}
        onClick={() => setSelectedEvent(event)}
      />
    );
  };

  // Render event details using the registry
  const renderEventDetails = () => {
    if (!selectedEvent) {
      return (
        <div className="flex items-center justify-center h-full text-chatroom-text-muted text-xs">
          Select an event to view details
        </div>
      );
    }

    const timestamp = selectedEvent.timestamp ?? selectedEvent._creationTime;
    const definition = getEventTypeDefinition(selectedEvent.type);

    if (definition) {
      return definition.detailsRenderer(selectedEvent as never);
    }

    return <PlaceholderEventDetails type={selectedEvent.type} timestamp={timestamp} />;
  };

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-5xl">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <FixedModalTitle className="flex items-center gap-2">
            <Activity size={14} className="text-chatroom-status-info" />
            Event Stream
          </FixedModalTitle>
        </FixedModalHeader>
        <FixedModalBody className="flex flex-col md:flex-row p-0 overflow-hidden" style={{ height: '70vh' }}>
          {/* Left: Event List */}
          <div className="md:w-2/5 border-r border-chatroom-border overflow-y-auto flex-shrink-0 flex flex-col">
            {/* Section header */}
            <div className="px-4 py-2 border-b border-chatroom-border bg-chatroom-bg-tertiary flex-shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
                Latest Events
              </span>
            </div>
            {/* Event list */}
            <div ref={eventListRef} className="flex-1 overflow-y-auto">
              {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-chatroom-text-muted">
                  <span className="text-xs">No events yet</span>
                </div>
              ) : (
                events.map(renderEventRow)
              )}
            </div>
            {/* Load more button */}
            {hasMore && onLoadMore && (
              <button
                onClick={handleLoadMore}
                className="flex-shrink-0 w-full py-2 text-xs text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors border-t border-chatroom-border"
              >
                Load more events
              </button>
            )}
          </div>
          {/* Right: Event Detail */}
          <div className="hidden md:flex md:flex-1 overflow-hidden w-full">
            <div className="flex flex-col h-full w-full overflow-hidden">
              {renderEventDetails()}
            </div>
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});