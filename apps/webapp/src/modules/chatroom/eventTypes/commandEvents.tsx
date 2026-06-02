'use client';

import type { EventTypeRegistry } from './registry';
import { EventRow, EventDetails, DetailRow, MachineDetailRow } from './shared';
import type { CommandRunEvent, CommandStopEvent } from '@/domain/entities/event-stream-event';

// ─── Command Run ──────────────────────────────────────────────────────────────

function renderCommandRunCell(event: CommandRunEvent, isSelected: boolean): React.ReactNode {
  return (
    <EventRow
      type="command.run"
      badgeText="Run"
      badgeColor="warning"
      primaryInfo={event.commandName}
      secondaryInfo={event.workingDir}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderCommandRunDetails(event: CommandRunEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Command Run"
      timestamp={event.timestamp}
      type="command.run"
    >
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Command" value={event.commandName} />
      <DetailRow label="Working Dir" value={event.workingDir} mono />
      <DetailRow label="Run ID" value={event.runId} mono />
      <DetailRow label="Script" value={event.script} mono />
    </EventDetails>
  );
}

// ─── Command Stop ─────────────────────────────────────────────────────────────

function renderCommandStopCell(event: CommandStopEvent, isSelected: boolean): React.ReactNode {
  return (
    <EventRow
      type="command.stop"
      badgeText="Stop"
      badgeColor="error"
      primaryInfo="Command"
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderCommandStopDetails(event: CommandStopEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Command Stop"
      timestamp={event.timestamp}
      type="command.stop"
    >
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Run ID" value={event.runId} mono />
    </EventDetails>
  );
}

// ─── Command event definitions ────────────────────────────────────────────────

export const commandEventDefinitions: Pick<
  EventTypeRegistry,
  'command.run' | 'command.stop'
> = {
  'command.run': {
    cellRenderer: renderCommandRunCell,
    detailsRenderer: renderCommandRunDetails,
  },
  'command.stop': {
    cellRenderer: renderCommandStopCell,
    detailsRenderer: renderCommandStopDetails,
  },
};
