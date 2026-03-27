'use client';

import { Activity, ArrowLeft } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  getEventTypeDefinition,
  initializeEventTypes,
  PlaceholderEventDetails,
  PlaceholderEventRow,
} from '../eventTypes';
import type { EventStreamEvent } from '../viewModels/eventStreamViewModel';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

// Initialize event type registry once at module load
initializeEventTypes();

// ─── Event Stream Modal ───────────────────────────────────────────────────────

interface EventStreamModalProps {
  isOpen: boolean;
  onClose: () => void;
  events: EventStreamEvent[];
  isLoading?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

export const EventStreamModal = memo(function EventStreamModal({
  isOpen,
  onClose,
  events,
  isLoading,
  onLoadMore,
  hasMore,
}: EventStreamModalProps) {
  // Track selected event for detail view
  const [selectedEvent, setSelectedEvent] = useState<EventStreamEvent | null>(null);
  // Track whether to show details on mobile (list/detail toggle)
  const [showMobileDetail, setShowMobileDetail] = useState(false);

  // Ref for the scrollable event list container
  const eventListRef = useRef<HTMLDivElement>(null);
  // Snapshot of scrollTop before loading more, used to restore scroll position
  const prevScrollTopRef = useRef<number | null>(null);
  // Track the event count when load-more was triggered to detect when new data has arrived
  const prevEventCountRef = useRef<number | null>(null);
  // Flag to track whether a load-more is pending (prevents real-time events from consuming saved state)
  const loadMorePendingRef = useRef(false);

  // Auto-select first event when events change
  useEffect(() => {
    if (events.length > 0 && !selectedEvent) {
      setSelectedEvent(events[0]);
    }
  }, [events, selectedEvent]);

  // Reset selection and mobile detail view when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedEvent(null);
      setShowMobileDetail(false);
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
  // We use useLayoutEffect (runs before browser paint) to prevent visible scroll jumps.
  // The loadMorePending flag ensures we only restore scroll when the user explicitly
  // clicked "load more". We wait until more events have actually arrived (count increased)
  // before restoring, so intermediate renders with stale data don't consume the saved state.
  useLayoutEffect(() => {
    const container = eventListRef.current;
    const savedScrollTop = prevScrollTopRef.current;
    const savedEventCount = prevEventCountRef.current;
    if (
      container &&
      savedScrollTop !== null &&
      savedEventCount !== null &&
      loadMorePendingRef.current
    ) {
      // Only restore once the event count has actually grown (new data arrived).
      // This prevents intermediate renders (same data, new array ref) from
      // consuming the saved scroll state before the real load-more data arrives.
      if (events.length > savedEventCount) {
        container.scrollTop = savedScrollTop;
        prevScrollTopRef.current = null;
        prevEventCountRef.current = null;
        loadMorePendingRef.current = false;
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
      loadMorePendingRef.current = true;
    }
    onLoadMore();
  }, [onLoadMore, events.length]);

  // Handle selecting an event – also show detail panel on mobile
  const handleSelectEvent = useCallback(
    (event: EventStreamEvent) => {
      setSelectedEvent(event);
      setShowMobileDetail(true);
    },
    []
  );

  // Render event row using the registry
  const renderEventRow = (event: EventStreamEvent) => {
    const isSelected = selectedEvent?._id === event._id;
    const timestamp = event.timestamp ?? event._creationTime;
    const definition = getEventTypeDefinition(event.type);

    if (definition) {
      return (
        <div key={event._id} onClick={() => handleSelectEvent(event)} className="cursor-pointer">
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
        onClick={() => handleSelectEvent(event)}
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

    return <PlaceholderEventDetails type={selectedEvent.type} timestamp={timestamp} eventId={selectedEvent._id} />;
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
        <FixedModalBody
          className="flex flex-col md:flex-row p-0 overflow-hidden"
        >
          {/* Left: Event List */}
          <div className={`md:w-2/5 border-r border-chatroom-border flex-1 min-h-0 md:flex-none flex flex-col ${showMobileDetail ? 'hidden md:flex' : 'flex'}`}>
            {/* Section header */}
            <div className="px-4 py-2 border-b border-chatroom-border bg-chatroom-bg-tertiary flex-shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
                Latest Events
              </span>
            </div>
            {/* Event list */}
            <div ref={eventListRef} className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex flex-col gap-2 p-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="w-2 h-2 rounded-full bg-chatroom-bg-tertiary animate-pulse" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-3/4 rounded bg-chatroom-bg-tertiary animate-pulse" />
                        <div className="h-2 w-1/2 rounded bg-chatroom-bg-tertiary animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : events.length === 0 ? (
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
          <div className={`${showMobileDetail ? 'flex' : 'hidden'} md:flex md:flex-1 overflow-hidden w-full min-h-0 flex-col`}>
            {/* Mobile back button */}
            <button
              onClick={() => setShowMobileDetail(false)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors border-b border-chatroom-border flex-shrink-0 md:hidden"
            >
              <ArrowLeft size={12} />
              Back to events
            </button>
            <div className="flex flex-col h-full w-full overflow-hidden flex-1">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <span className="text-xs text-chatroom-text-muted animate-pulse">Loading events…</span>
                </div>
              ) : (
                renderEventDetails()
              )}
            </div>
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
