'use client';

import type { EventTypeRegistry } from './registry';
import { DetailRow, EventDetails, EventRow, MachineDetailRow } from './shared';

import type { ConnectionTerminatedEvent } from '@/domain/entities/event-stream-event';

function renderConnectionTerminatedCell(
  event: ConnectionTerminatedEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="connection.terminated"
      badgeText="Terminated"
      badgeColor="muted"
      primaryInfo={event.role}
      secondaryInfo={event.reason}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderConnectionTerminatedDetails(event: ConnectionTerminatedEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Connection Terminated"
      timestamp={event.timestamp}
      type="connection.terminated"
    >
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Connection ID" value={event.connectionId} mono />
      {event.machineId && <MachineDetailRow machineId={event.machineId} />}
      <DetailRow label="Reason" value={event.reason} />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

export const connectionEventDefinitions: Pick<EventTypeRegistry, 'connection.terminated'> = {
  'connection.terminated': {
    cellRenderer: renderConnectionTerminatedCell,
    detailsRenderer: renderConnectionTerminatedDetails,
  },
};
