'use client';

import type { EventTypeRegistry } from './registry';
import { EventRow, EventDetails, DetailRow, MachineDetailRow } from './shared';

import type {
  DaemonPingEvent,
  DaemonPongEvent,
  DaemonGitRefreshEvent,
  DaemonRefreshCapabilitiesEvent,
  DaemonPickFolderEvent,
  DaemonLocalActionEvent,
} from '@/domain/entities/event-stream-event';

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

// ─── Daemon Capabilities Refresh ─────────────────────────────────────────────

function renderDaemonRefreshCapabilitiesCell(
  event: DaemonRefreshCapabilitiesEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="daemon.refreshCapabilities"
      badgeText="Discovery"
      badgeColor="muted"
      primaryInfo="Daemon"
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderDaemonRefreshCapabilitiesDetails(
  event: DaemonRefreshCapabilitiesEvent
): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Capabilities refresh"
      timestamp={event.timestamp}
      type="daemon.refreshCapabilities"
    >
      <MachineDetailRow machineId={event.machineId} />
      {event.batchId ? <DetailRow label="Batch ID" value={event.batchId} mono /> : null}
    </EventDetails>
  );
}

// ─── Daemon Local Action ──────────────────────────────────────────────────────

function renderDaemonLocalActionCell(
  event: DaemonLocalActionEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="daemon.localAction"
      badgeText="Local Action"
      badgeColor="muted"
      primaryInfo={event.action}
      secondaryInfo={event.workingDir}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderDaemonLocalActionDetails(event: DaemonLocalActionEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Local Action"
      timestamp={event.timestamp}
      type="daemon.localAction"
    >
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Action" value={event.action} />
      <DetailRow label="Working Dir" value={event.workingDir} mono />
    </EventDetails>
  );
}

// ─── Daemon Pick Folder ───────────────────────────────────────────────────────

function renderDaemonPickFolderCell(
  event: DaemonPickFolderEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="daemon.pickFolder"
      badgeText="Pick Folder"
      badgeColor="muted"
      primaryInfo="Daemon"
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderDaemonPickFolderDetails(event: DaemonPickFolderEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Pick Folder"
      timestamp={event.timestamp}
      type="daemon.pickFolder"
    >
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Request ID" value={event.requestId} mono />
    </EventDetails>
  );
}

// ─── Daemon event definitions ───────────────────────────────────────────────────

export const daemonEventDefinitions: Pick<
  EventTypeRegistry,
  | 'daemon.ping'
  | 'daemon.pong'
  | 'daemon.gitRefresh'
  | 'daemon.refreshCapabilities'
  | 'daemon.pickFolder'
  | 'daemon.localAction'
> = {
  'daemon.ping': {
    cellRenderer: renderDaemonPingCell,
    detailsRenderer: renderDaemonPingDetails,
  },
  'daemon.pong': {
    cellRenderer: renderDaemonPongCell,
    detailsRenderer: renderDaemonPongDetails,
  },
  'daemon.gitRefresh': {
    cellRenderer: renderDaemonGitRefreshCell,
    detailsRenderer: renderDaemonGitRefreshDetails,
  },
  'daemon.refreshCapabilities': {
    cellRenderer: renderDaemonRefreshCapabilitiesCell,
    detailsRenderer: renderDaemonRefreshCapabilitiesDetails,
  },
  'daemon.pickFolder': {
    cellRenderer: renderDaemonPickFolderCell,
    detailsRenderer: renderDaemonPickFolderDetails,
  },
  'daemon.localAction': {
    cellRenderer: renderDaemonLocalActionCell,
    detailsRenderer: renderDaemonLocalActionDetails,
  },
};
