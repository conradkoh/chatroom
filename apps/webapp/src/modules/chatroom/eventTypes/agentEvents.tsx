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
    <EventDetails title="Agent Started" timestamp={event.timestamp} type="agent.started">
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
  const status = event.intentional ? 'Exit' : 'Crash';
  return (
    <EventRow
      type="agent.exited"
      badgeText={status}
      badgeColor="error"
      primaryInfo={event.role}
      secondaryInfo={event.intentional ? `exit(${event.exitCode ?? 0})` : `signal ${event.signal ?? 'unknown'}`}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentExitedDetails(event: AgentExitedEvent): React.ReactNode {
  return (
    <EventDetails title="Agent Exited" timestamp={event.timestamp} type="agent.exited">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Machine ID" value={event.machineId} mono />
      <DetailRow label="PID" value={String(event.pid)} mono />
      <DetailRow label="Intentional" value={event.intentional ? 'Yes' : 'No'} />
      {event.stopReason && <DetailRow label="Stop Reason" value={event.stopReason} />}
      {event.stopSignal && <DetailRow label="Stop Signal" value={event.stopSignal} />}
      {event.exitCode !== undefined && <DetailRow label="Exit Code" value={String(event.exitCode)} mono />}
      {event.signal && <DetailRow label="Signal" value={event.signal} mono />}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Circuit Open ───────────────────────────────────────────────────────

function renderAgentCircuitOpenCell(event: AgentCircuitOpenEvent, isSelected: boolean): React.ReactNode {
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
    <EventDetails title="Circuit Breaker Open" timestamp={event.timestamp} type="agent.circuitOpen">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Machine ID" value={event.machineId} mono />
      <DetailRow label="Reason" value={event.reason} />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Request Start ──────────────────────────────────────────────────────

function renderAgentRequestStartCell(event: AgentRequestStartEvent, isSelected: boolean): React.ReactNode {
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
    <EventDetails title="Agent Start Requested" timestamp={event.timestamp} type="agent.requestStart">
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

function renderAgentRequestStopCell(event: AgentRequestStopEvent, isSelected: boolean): React.ReactNode {
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
    <EventDetails title="Agent Stop Requested" timestamp={event.timestamp} type="agent.requestStop">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Machine ID" value={event.machineId} mono />
      <DetailRow label="Reason" value={event.reason} />
      <DetailRow label="Deadline" value={formatTimestampFull(event.deadline)} mono />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Registered ─────────────────────────────────────────────────────────-

function renderAgentRegisteredCell(event: AgentRegisteredEvent, isSelected: boolean): React.ReactNode {
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
    <EventDetails title="Agent Registered" timestamp={event.timestamp} type="agent.registered">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Agent Type" value={event.agentType} />
      {event.machineId && <DetailRow label="Machine ID" value={event.machineId} mono />}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Waiting ────────────────────────────────────────────────────────────

function renderAgentWaitingingCell(event: AgentWaitingEvent, isSelected: boolean): React.ReactNode {
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
    <EventDetails title="Agent Waiting" timestamp={event.timestamp} type="agent.waiting">
      <DetailRow label="Role" value={event.role} />
      {event.machineId && <DetailRow label="Machine ID" value={event.machineId} mono />}
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
    cellRenderer: renderAgentWaitingingCell,
    detailsRenderer: renderAgentWaitingDetails,
  });
}