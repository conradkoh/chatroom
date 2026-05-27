'use client';

import { registerEventType } from './registry';
import { EventRow, EventDetails, DetailRow, MachineDetailRow } from './shared';
import type { ConfigRequestRemovalEvent } from '../viewModels/eventStreamViewModel';

// ─── Config Request Removal ───────────────────────────────────────────────────

function renderConfigRequestRemovalCell(
  event: ConfigRequestRemovalEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="config.requestRemoval"
      badgeText="Removal"
      badgeColor="warning"
      primaryInfo={event.role}
      secondaryInfo={event.reason}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderConfigRequestRemovalDetails(event: ConfigRequestRemovalEvent): React.ReactNode {
  return (
    <EventDetails
      title="Config Request Removal"
      timestamp={event.timestamp}
      type="config.requestRemoval"
    >
      <DetailRow label="Role" value={event.role} />
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Reason" value={event.reason} />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Register config event types ───────────────────────────────────────────────

export function registerConfigEvents(): void {
  registerEventType('config.requestRemoval', {
    cellRenderer: renderConfigRequestRemovalCell,
    detailsRenderer: renderConfigRequestRemovalDetails,
  });
}
