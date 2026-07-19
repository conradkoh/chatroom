'use client';

import { useCallback } from 'react';

import { resolveEventTypeDefinition } from '../../eventTypes';
import type { EventStreamEvent } from '../../viewModels/eventStreamViewModel';
import { VirtualizedScrollList } from '../virtual-list';

export const EVENT_STREAM_ROW_HEIGHT = 52;

interface EventStreamModalVirtualizedListProps {
  events: EventStreamEvent[];
  selectedEventId: string | null;
  onSelectEvent: (event: EventStreamEvent) => void;
  listRef?: React.Ref<HTMLDivElement>;
  height: number | string;
}

export function EventStreamModalVirtualizedList({
  events,
  selectedEventId,
  onSelectEvent,
  listRef,
  height,
}: EventStreamModalVirtualizedListProps) {
  const estimateSize = useCallback(() => EVENT_STREAM_ROW_HEIGHT, []);
  const getItemKey = useCallback((_i: number, e: EventStreamEvent) => e._id, []);
  const renderItem = useCallback(
    (event: EventStreamEvent) => {
      const isSelected = selectedEventId === event._id;
      const definition = resolveEventTypeDefinition(event);
      return (
        <div onClick={() => onSelectEvent(event)} className="cursor-pointer">
          {definition.cellRenderer(event as never, isSelected)}
        </div>
      );
    },
    [selectedEventId, onSelectEvent]
  );

  return (
    <VirtualizedScrollList
      items={events}
      height={height}
      estimateSize={estimateSize}
      getItemKey={getItemKey}
      renderItem={renderItem}
      listRef={listRef}
      className="flex-1"
    />
  );
}
