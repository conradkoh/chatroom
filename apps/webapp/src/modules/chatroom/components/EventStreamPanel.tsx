'use client';

import { ArrowLeft } from 'lucide-react';
import { memo, useCallback, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';

import { EventStreamModalVirtualizedList } from './EventStreamModal/EventStreamModalVirtualizedList';
import {
  EventStreamMachineProvider,
  type MachineNameEntry,
} from '../context/EventStreamMachineContext';
import { resolveEventTypeDefinition, initializeEventTypes } from '../eventTypes';
import type { EventStreamEvent } from '../viewModels/eventStreamViewModel';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

initializeEventTypes();

export interface EventStreamPanelProps {
  events: EventStreamEvent[];
  isLoading?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
  machines?: Map<string, MachineNameEntry>;
  className?: string;
}

function restoreScrollAfterLoadMore(
  container: HTMLDivElement | null,
  events: EventStreamEvent[],
  prevScrollTopRef: MutableRefObject<number | null>,
  prevEventCountRef: MutableRefObject<number | null>,
  loadMorePendingRef: MutableRefObject<boolean>
) {
  const savedScrollTop = prevScrollTopRef.current;
  const savedEventCount = prevEventCountRef.current;
  if (
    container &&
    savedScrollTop !== null &&
    savedEventCount !== null &&
    loadMorePendingRef.current &&
    events.length > savedEventCount
  ) {
    container.scrollTop = savedScrollTop;
    prevScrollTopRef.current = null;
    prevEventCountRef.current = null;
    loadMorePendingRef.current = false;
  }
}

// fallow-ignore-next-line complexity
function useScrollRestoreOnLoadMore(events: EventStreamEvent[], onLoadMore?: () => void) {
  const eventListRef = useRef<HTMLDivElement>(null);
  const prevScrollTopRef = useRef<number | null>(null);
  const prevEventCountRef = useRef<number | null>(null);
  const loadMorePendingRef = useRef(false);

  useLayoutEffect(() => {
    restoreScrollAfterLoadMore(
      eventListRef.current,
      events,
      prevScrollTopRef,
      prevEventCountRef,
      loadMorePendingRef
    );
  }, [events]);

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

  return { eventListRef, handleLoadMore };
}

function EventStreamListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <div className="w-2 h-2 bg-chatroom-bg-tertiary animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-3/4 rounded bg-chatroom-bg-tertiary animate-pulse" />
            <div className="h-2 w-1/2 rounded bg-chatroom-bg-tertiary animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface EventStreamListPaneProps {
  events: EventStreamEvent[];
  isLoading: boolean;
  selectedEventId: string | null;
  onSelectEvent: (event: EventStreamEvent) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
  hasMore: boolean;
  onLoadMore?: () => void;
  handleLoadMore: () => void;
  hiddenOnMobile: boolean;
}

// fallow-ignore-next-line complexity
function EventStreamListPane({
  events,
  isLoading,
  selectedEventId,
  onSelectEvent,
  listRef,
  hasMore,
  onLoadMore,
  handleLoadMore,
  hiddenOnMobile,
}: EventStreamListPaneProps) {
  return (
    <div
      className={`md:w-2/5 border-r border-chatroom-border flex-1 min-h-0 md:flex-none flex flex-col ${hiddenOnMobile ? 'hidden md:flex' : 'flex'}`}
    >
      <div className="px-4 py-2 border-b border-chatroom-border bg-chatroom-bg-tertiary flex-shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          Latest Events
        </span>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        {isLoading ? (
          <EventStreamListSkeleton />
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-chatroom-text-muted">
            <span className="text-xs">No events yet</span>
          </div>
        ) : (
          <EventStreamModalVirtualizedList
            events={events}
            selectedEventId={selectedEventId}
            onSelectEvent={onSelectEvent}
            listRef={listRef}
            height="100%"
          />
        )}
      </div>
      {hasMore && onLoadMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          className="flex-shrink-0 w-full py-2 text-xs text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors border-t border-chatroom-border"
        >
          Load more events
        </button>
      )}
    </div>
  );
}

interface EventStreamDetailPaneProps {
  event: EventStreamEvent | null;
  isLoading: boolean;
  showOnMobile: boolean;
  onBack: () => void;
}

function EventStreamDetailPane({
  event,
  isLoading,
  showOnMobile,
  onBack,
}: EventStreamDetailPaneProps) {
  const renderDetails = () => {
    if (!event) {
      return (
        <div className="flex items-center justify-center h-full text-chatroom-text-muted text-xs">
          Select an event to view details
        </div>
      );
    }
    const definition = resolveEventTypeDefinition(event);
    return definition.detailsRenderer(event as never);
  };

  return (
    <div
      className={`${showOnMobile ? 'flex' : 'hidden'} md:flex md:flex-1 overflow-hidden w-full min-h-0 flex-col`}
    >
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 px-4 py-2 text-xs text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors border-b border-chatroom-border flex-shrink-0 md:hidden"
      >
        <ArrowLeft size={12} />
        Back to events
      </button>
      <div className="flex flex-col h-full w-full overflow-hidden flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <ChatroomLoader size="sm" />
          </div>
        ) : (
          renderDetails()
        )}
      </div>
    </div>
  );
}

// fallow-ignore-next-line complexity
export const EventStreamPanel = memo(function EventStreamPanel({
  events,
  isLoading = false,
  onLoadMore,
  hasMore = false,
  machines,
  className = '',
}: EventStreamPanelProps) {
  const [selectedEvent, setSelectedEvent] = useState<EventStreamEvent | null>(null);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const { eventListRef, handleLoadMore } = useScrollRestoreOnLoadMore(events, onLoadMore);

  const handleSelectEvent = useCallback((event: EventStreamEvent) => {
    setSelectedEvent(event);
    setShowMobileDetail(true);
  }, []);

  const selectedId = selectedEvent?._id ?? null;
  const resolvedSelection =
    selectedId && events.some((event) => event._id === selectedId)
      ? selectedEvent
      : (events[0] ?? null);

  return (
    <EventStreamMachineProvider value={machines}>
      <div
        className={`flex flex-col md:flex-row min-h-[420px] h-full overflow-hidden border border-chatroom-border bg-chatroom-bg-primary ${className}`}
        data-testid="event-stream-panel"
      >
        <EventStreamListPane
          events={events}
          isLoading={isLoading}
          selectedEventId={resolvedSelection?._id ?? null}
          onSelectEvent={handleSelectEvent}
          listRef={eventListRef}
          hasMore={hasMore}
          onLoadMore={onLoadMore}
          handleLoadMore={handleLoadMore}
          hiddenOnMobile={showMobileDetail}
        />
        <EventStreamDetailPane
          event={resolvedSelection}
          isLoading={isLoading}
          showOnMobile={showMobileDetail}
          onBack={() => setShowMobileDetail(false)}
        />
      </div>
    </EventStreamMachineProvider>
  );
});
