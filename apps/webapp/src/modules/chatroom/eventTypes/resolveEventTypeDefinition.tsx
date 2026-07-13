'use client';

import { getEventTypeDefinition } from './registry';
import type { EventTypeDefinition } from './registry';
import { PlaceholderEventDetails, PlaceholderEventRow } from './shared';

import type { EventStreamEvent } from '@/domain/entities/event-stream-event';
import { isSupportedEventType } from '@/domain/entities/event-type';

type EventRenderContext = Pick<EventStreamEvent, '_id' | 'timestamp' | '_creationTime'> & {
  type: string;
};

/**
 * Resolve list/detail renderers for an event stream row.
 * Known types use the exhaustive registry; unknown runtime types fall back to placeholders.
 */
export function resolveEventTypeDefinition(
  event: EventRenderContext
): EventTypeDefinition<EventStreamEvent> {
  if (isSupportedEventType(event.type)) {
    return getEventTypeDefinition(event.type) as EventTypeDefinition<EventStreamEvent>;
  }

  const timestamp = event.timestamp ?? event._creationTime;
  const type = event.type;

  return {
    cellRenderer: (_event, isSelected) => (
      <PlaceholderEventRow type={type} timestamp={timestamp} isSelected={isSelected} />
    ),
    detailsRenderer: () => (
      <PlaceholderEventDetails type={type} timestamp={timestamp} eventId={event._id} />
    ),
  };
}
