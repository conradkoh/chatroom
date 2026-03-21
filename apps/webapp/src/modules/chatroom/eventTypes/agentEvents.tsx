'use client';

import { registerEventType } from './registry';
import { EventRow, EventDetails, DetailRow } from './shared';
import type {
  AgentStartedEvent,
  AgentExitedEvent,
  AgentCircuitOpenEvent,
  AgentRequestStartEvent,
  AgentRequestStopEvent,
  AgentRegisteredEvent,
  AgentWaitingEvent,
  AgentStartFailedEvent,
  AgentRestartLimitReachedEvent,
} from '../viewModels/eventStreamViewModel';
import { formatTimestampFull } from '../viewModels/eventStreamViewModel';

// ─── Agent Started ───────────────────────────────────────────────────────────

function renderAgentStartedCell(event: AgentStartedEvent, isSelected: boolean): React.ReactNode {
  return (
    <EventRow
      type="agent.started"
      badgeText="Started"
      badgeColor="success"
      primaryInfo={event.role}
      secondaryInfo={event.model}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentStartedDetails(event: AgentStartedEvent): React.ReactNode {
  return (
    <EventDetails eventId={event._id} title="Agent Started" timestamp={event.timestamp} type="agent.started">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Machine ID" value={event.machineId} mono />
      <DetailRow label="Harness" value={event.agentHarness} />
      <DetailRow label="Model" value={event.model} mono />
      <DetailRow label="Working Dir" value={event.workingDir} mono />
      <DetailRow label="PID" value={String(event.pid)} mono />
      {event.reason && <DetailRow label="Reason" value={event.reason} />}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Exited ────────────────────────────────────────────────────────────

function renderAgentExitedCell(event: AgentExitedEvent, isSelected: boolean): React.ReactNode {
  let badgeText: string;
  let badgeColor: 'info' | 'warning' | 'error';

  switch (event.stopReason) {
    case 'user.stop':
    case 'platform.team_switch':
      badgeText = 'Stopped';
      badgeColor = 'info';
      break;
    case 'agent_process.exited_clean':
    case 'daemon.respawn':
      badgeText = 'Exit';
      badgeColor = 'warning';
      break;
    case 'agent_process.crashed':
      badgeText = 'Crash';
      badgeColor = 'error';
      break;
    case 'agent_process.signal':
      badgeText = 'Signal';
      badgeColor = 'error';
      break;
    default:
      // Legacy events without stopReason — fall back to intentional field
      badgeText = event.intentional ? 'Exit' : 'Crash';
      badgeColor = 'error';
      break;
  }

  const exitCodeStr = event.exitCode !== undefined ? `exit(${event.exitCode}) ` : '';
  const secondaryInfo = event.stopReason
    ? `${exitCodeStr}${event.stopReason}`
    : event.stopReason ?? 'unknown';

  return (
    <EventRow
      type="agent.exited"
      badgeText={badgeText}
      badgeColor={badgeColor}
      primaryInfo={event.role}
      secondaryInfo={secondaryInfo}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentExitedDetails(event: AgentExitedEvent): React.ReactNode {
  return (
    <EventDetails eventId={event._id} title="Agent Exited" timestamp={event.timestamp} type="agent.exited">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Machine ID" value={event.machineId} mono />
      <DetailRow label="PID" value={String(event.pid)} mono />
      <DetailRow
        label="Stop Reason"
        value={event.stopReason ?? (event.intentional ? 'intentional' : 'unknown')}
      />
      {event.stopSignal && <DetailRow label="Stop Signal" value={event.stopSignal} />}
      {event.exitCode !== undefined && (
        <DetailRow label="Exit Code" value={String(event.exitCode)} mono />
      )}
      {event.signal && <DetailRow label="Signal" value={event.signal} mono />}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Circuit Open ───────────────────────────────────────────────────────

function renderAgentCircuitOpenCell(
  event: AgentCircuitOpenEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="agent.circuitOpen"
      badgeText="Circuit Open"
      badgeColor="warning"
      primaryInfo={event.role}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentCircuitOpenDetails(event: AgentCircuitOpenEvent): React.ReactNode {
  return (
    <EventDetails eventId={event._id} title="Circuit Breaker Open" timestamp={event.timestamp} type="agent.circuitOpen">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Machine ID" value={event.machineId} mono />
      <DetailRow label="Reason" value={event.reason} />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Request Start ──────────────────────────────────────────────────────

function renderAgentRequestStartCell(
  event: AgentRequestStartEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="agent.requestStart"
      badgeText="Req Start"
      badgeColor="warning"
      primaryInfo={event.role}
      secondaryInfo={event.reason}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentRequestStartDetails(event: AgentRequestStartEvent): React.ReactNode {
  return (
    <EventDetails
      title="Agent Start Requested"
      timestamp={event.timestamp}
      type="agent.requestStart"
    >
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Machine ID" value={event.machineId} mono />
      <DetailRow label="Harness" value={event.agentHarness} />
      <DetailRow label="Model" value={event.model} mono />
      <DetailRow label="Working Dir" value={event.workingDir} mono />
      <DetailRow label="Reason" value={event.reason} />
      <DetailRow label="Deadline" value={formatTimestampFull(event.deadline)} mono />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Request Stop ───────────────────────────────────────────────────────

function renderAgentRequestStopCell(
  event: AgentRequestStopEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="agent.requestStop"
      badgeText="Req Stop"
      badgeColor="error"
      primaryInfo={event.role}
      secondaryInfo={event.reason}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentRequestStopDetails(event: AgentRequestStopEvent): React.ReactNode {
  return (
    <EventDetails eventId={event._id} title="Agent Stop Requested" timestamp={event.timestamp} type="agent.requestStop">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Machine ID" value={event.machineId} mono />
      <DetailRow label="Reason" value={event.reason} />
      <DetailRow label="Deadline" value={formatTimestampFull(event.deadline)} mono />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Registered ─────────────────────────────────────────────────────────-

function renderAgentRegisteredCell(
  event: AgentRegisteredEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="agent.registered"
      badgeText="Registered"
      badgeColor="success"
      primaryInfo={event.role}
      secondaryInfo={event.agentType}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentRegisteredDetails(event: AgentRegisteredEvent): React.ReactNode {
  return (
    <EventDetails eventId={event._id} title="Agent Registered" timestamp={event.timestamp} type="agent.registered">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Agent Type" value={event.agentType} />
      {event.machineId && <DetailRow label="Machine ID" value={event.machineId} mono />}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Waiting ────────────────────────────────────────────────────────────

function renderAgentWaitingCell(event: AgentWaitingEvent, isSelected: boolean): React.ReactNode {
  return (
    <EventRow
      type="agent.waiting"
      badgeText="Waiting"
      badgeColor="success"
      primaryInfo={event.role}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentWaitingDetails(event: AgentWaitingEvent): React.ReactNode {
  return (
    <EventDetails eventId={event._id} title="Agent Waiting" timestamp={event.timestamp} type="agent.waiting">
      <DetailRow label="Role" value={event.role} />
      {event.machineId && <DetailRow label="Machine ID" value={event.machineId} mono />}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Start Failed ───────────────────────────────────────────────────────

function renderAgentStartFailedCell(
  event: AgentStartFailedEvent,
  isSelected: boolean
): React.ReactNode {
  const truncatedError =
    event.error.length > 60 ? event.error.substring(0, 57) + '...' : event.error;
  return (
    <EventRow
      type="agent.startFailed"
      badgeText="Start Failed"
      badgeColor="error"
      primaryInfo={event.role}
      secondaryInfo={truncatedError}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentStartFailedDetails(event: AgentStartFailedEvent): React.ReactNode {
  return (
    <EventDetails eventId={event._id} title="Agent Start Failed" timestamp={event.timestamp} type="agent.startFailed">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Machine ID" value={event.machineId} mono />
      <DetailRow label="Error" value={event.error} />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Restart Limit Reached ──────────────────────────────────────────────

function renderAgentRestartLimitReachedCell(
  event: AgentRestartLimitReachedEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="agent.restartLimitReached"
      badgeText="Restart Limit"
      badgeColor="error"
      primaryInfo={event.role}
      secondaryInfo={`${event.restartCount} restarts in ${event.windowMs / 1000}s`}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentRestartLimitReachedDetails(
  event: AgentRestartLimitReachedEvent
): React.ReactNode {
  return (
    <EventDetails
      title="Agent Restart Limit Reached"
      timestamp={event.timestamp}
      type="agent.restartLimitReached"
    >
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Machine ID" value={event.machineId} mono />
      <DetailRow label="Restart Count" value={String(event.restartCount)} />
      <DetailRow label="Window" value={`${event.windowMs / 1000}s`} />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Register all agent event types ────────────────────────────────────────────

export function registerAgentEvents(): void {
  registerEventType('agent.started', {
    cellRenderer: renderAgentStartedCell,
    detailsRenderer: renderAgentStartedDetails,
  });
  registerEventType('agent.exited', {
    cellRenderer: renderAgentExitedCell,
    detailsRenderer: renderAgentExitedDetails,
  });
  registerEventType('agent.circuitOpen', {
    cellRenderer: renderAgentCircuitOpenCell,
    detailsRenderer: renderAgentCircuitOpenDetails,
  });
  registerEventType('agent.requestStart', {
    cellRenderer: renderAgentRequestStartCell,
    detailsRenderer: renderAgentRequestStartDetails,
  });
  registerEventType('agent.requestStop', {
    cellRenderer: renderAgentRequestStopCell,
    detailsRenderer: renderAgentRequestStopDetails,
  });
  registerEventType('agent.registered', {
    cellRenderer: renderAgentRegisteredCell,
    detailsRenderer: renderAgentRegisteredDetails,
  });
  registerEventType('agent.waiting', {
    cellRenderer: renderAgentWaitingCell,
    detailsRenderer: renderAgentWaitingDetails,
  });
  registerEventType('agent.startFailed', {
    cellRenderer: renderAgentStartFailedCell,
    detailsRenderer: renderAgentStartFailedDetails,
  });
  registerEventType('agent.restartLimitReached', {
    cellRenderer: renderAgentRestartLimitReachedCell,
    detailsRenderer: renderAgentRestartLimitReachedDetails,
  });
}
