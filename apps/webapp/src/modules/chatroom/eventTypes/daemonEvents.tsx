'use client';

import { registerEventType } from './registry';
import { EventRow, EventDetails, DetailRow, MachineDetailRow } from './shared';
import type {
  DaemonPingEvent,
  DaemonPongEvent,
  DaemonGitRefreshEvent,
} from '../viewModels/eventStreamViewModel';

// ─── Daemon Ping ──────────────────────────────────────────────────────────────

function renderDaemonPingCell(event: DaemonPingEvent, isSelected: boolean): React.ReactNode {
  return (
    <EventRow
      type="daemon.ping"
      badgeText="Ping"
      badgeColor="muted"
      primaryInfo="Daemon"
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderDaemonPingDetails(event: DaemonPingEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Daemon Ping"
      timestamp={event.timestamp}
      type="daemon.ping"
    >
      <MachineDetailRow machineId={event.machineId} />
    </EventDetails>
  );
}

// ─── Daemon Pong ──────────────────────────────────────────────────────────────

function renderDaemonPongCell(event: DaemonPongEvent, isSelected: boolean): React.ReactNode {
  return (
    <EventRow
      type="daemon.pong"
      badgeText="Pong"
      badgeColor="muted"
      primaryInfo="Daemon"
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderDaemonPongDetails(event: DaemonPongEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Daemon Pong"
      timestamp={event.timestamp}
      type="daemon.pong"
    >
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Ping Event ID" value={event.pingEventId} mono />
    </EventDetails>
  );
}

// ─── Daemon Git Refresh ───────────────────────────────────────────────────────

function renderDaemonGitRefreshCell(
  event: DaemonGitRefreshEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="daemon.gitRefresh"
      badgeText="Git Refresh"
      badgeColor="muted"
      primaryInfo="Daemon"
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderDaemonGitRefreshDetails(event: DaemonGitRefreshEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Git Refresh"
      timestamp={event.timestamp}
      type="daemon.gitRefresh"
    >
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Working Dir" value={event.workingDir} mono />
    </EventDetails>
  );
}

// ─── Register all daemon event types ───────────────────────────────────────────

export function registerDaemonEvents(): void {
  registerEventType('daemon.ping', {
    cellRenderer: renderDaemonPingCell,
    detailsRenderer: renderDaemonPingDetails,
  });
  registerEventType('daemon.pong', {
    cellRenderer: renderDaemonPongCell,
    detailsRenderer: renderDaemonPongDetails,
  });
  registerEventType('daemon.gitRefresh', {
    cellRenderer: renderDaemonGitRefreshCell,
    detailsRenderer: renderDaemonGitRefreshDetails,
  });
}
