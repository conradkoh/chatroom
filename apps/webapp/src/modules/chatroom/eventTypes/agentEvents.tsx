'use client';

import type { EventTypeRegistry } from './registry';
import { EventRow, EventDetails, DetailRow, MachineDetailRow } from './shared';
import { formatTimestampFull } from '../viewModels/eventStreamViewModel';

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
  AgentSessionResumeRequestedEvent,
  AgentSessionResumedEvent,
  AgentSessionResumeFailedEvent,
  AgentSessionReopenRetryEvent,
  AgentResumeStormAbortedEvent,
  MachineSwitchedEvent,
} from '@/domain/entities/event-stream-event';
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
    <EventDetails
      eventId={event._id}
      title="Agent Started"
      timestamp={event.timestamp}
      type="agent.started"
    >
      <DetailRow label="Role" value={event.role} />
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Harness" value={event.agentHarness} />
      <DetailRow label="Model" value={event.model} mono />
      <DetailRow label="Working Dir" value={event.workingDir} mono />
      <DetailRow label="PID" value={String(event.pid)} mono />
      {event.reason && <DetailRow label="Reason" value={event.reason} />}
      {event.harnessSessionId && (
        <DetailRow label="Harness Session ID" value={event.harnessSessionId} mono />
      )}
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
    case 'daemon.shutdown':
      badgeText = 'Daemon Shutdown';
      badgeColor = 'info';
      break;
    case 'agent_process.exited_clean':
    case 'daemon.respawn':
      badgeText = 'Exit';
      badgeColor = 'warning';
      break;
    case 'platform.resume_storm':
      badgeText = 'Resume Storm';
      badgeColor = 'error';
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
    : (event.stopReason ?? 'unknown');

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
    <EventDetails
      eventId={event._id}
      title="Agent Exited"
      timestamp={event.timestamp}
      type="agent.exited"
    >
      <DetailRow label="Role" value={event.role} />
      <MachineDetailRow machineId={event.machineId} />
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
    <EventDetails
      eventId={event._id}
      title="Circuit Breaker Open"
      timestamp={event.timestamp}
      type="agent.circuitOpen"
    >
      <DetailRow label="Role" value={event.role} />
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Reason" value={event.reason} />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Request Start ──────────────────────────────────────────────────────

function formatWantResumeLabel(wantResume: boolean | undefined): string {
  return wantResume === false ? 'resume off' : 'resume on';
}

function formatAutoRestartOnNewContextLabel(autoRestartOnNewContext: boolean | undefined): string {
  if (autoRestartOnNewContext === undefined) return 'new context restart unset';
  return autoRestartOnNewContext ? 'new context restart on' : 'new context restart off';
}

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
      secondaryInfo={`${formatWantResumeLabel(event.wantResume)} · ${formatAutoRestartOnNewContextLabel(event.autoRestartOnNewContext)} · ${event.reason}`}
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
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Harness" value={event.agentHarness} />
      <DetailRow label="Model" value={event.model} mono />
      <DetailRow label="Working Dir" value={event.workingDir} mono />
      <DetailRow label="Reason" value={event.reason} />
      <DetailRow label="Resume session" value={formatWantResumeLabel(event.wantResume)} />
      <DetailRow
        label="Restart on new context"
        value={formatAutoRestartOnNewContextLabel(event.autoRestartOnNewContext)}
      />
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
    <EventDetails
      eventId={event._id}
      title="Agent Stop Requested"
      timestamp={event.timestamp}
      type="agent.requestStop"
    >
      <DetailRow label="Role" value={event.role} />
      <MachineDetailRow machineId={event.machineId} />
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
    <EventDetails
      eventId={event._id}
      title="Agent Registered"
      timestamp={event.timestamp}
      type="agent.registered"
    >
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Agent Type" value={event.agentType} />
      {event.machineId && <MachineDetailRow machineId={event.machineId} />}
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
    <EventDetails
      eventId={event._id}
      title="Agent Waiting"
      timestamp={event.timestamp}
      type="agent.waiting"
    >
      <DetailRow label="Role" value={event.role} />
      {event.machineId && <MachineDetailRow machineId={event.machineId} />}
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
    <EventDetails
      eventId={event._id}
      title="Agent Start Failed"
      timestamp={event.timestamp}
      type="agent.startFailed"
    >
      <DetailRow label="Role" value={event.role} />
      <MachineDetailRow machineId={event.machineId} />
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
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Restart Count" value={String(event.restartCount)} />
      <DetailRow label="Window" value={`${event.windowMs / 1000}s`} />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Resume Storm Aborted ─────────────────────────────────────────────

const RESUME_STORM_REASON_LABELS: Record<AgentResumeStormAbortedEvent['reason'], string> = {
  unknown: 'Unknown',
  auth_error: 'Auth error',
  rate_limit: 'Rate limit',
  config_error: 'Config error',
};

function formatResumeStormReason(reason: AgentResumeStormAbortedEvent['reason']): string {
  return RESUME_STORM_REASON_LABELS[reason] ?? reason;
}

function renderAgentResumeStormAbortedCell(
  event: AgentResumeStormAbortedEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="agent.resumeStormAborted"
      badgeText="Resume Storm"
      badgeColor="error"
      primaryInfo={event.role}
      secondaryInfo={`${formatResumeStormReason(event.reason)} (${event.endCount} ends / ${event.windowMs / 1000}s)`}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentResumeStormAbortedDetails(
  event: AgentResumeStormAbortedEvent
): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Resume Storm Aborted"
      timestamp={event.timestamp}
      type="agent.resumeStormAborted"
    >
      <DetailRow label="Role" value={event.role} />
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Reason" value={formatResumeStormReason(event.reason)} />
      <DetailRow label="End Count" value={String(event.endCount)} />
      <DetailRow label="Window" value={`${event.windowMs / 1000}s`} />
      {event.harnessSessionId && (
        <DetailRow label="Harness Session ID" value={event.harnessSessionId} mono />
      )}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Session Resume Requested ───────────────────────────────────────────

function renderAgentSessionResumeRequestedCell(
  event: AgentSessionResumeRequestedEvent,
  isSelected: boolean
): React.ReactNode {
  const truncatedSessionId = event.harnessSessionId
    ? event.harnessSessionId.length > 60
      ? event.harnessSessionId.substring(0, 57) + '...'
      : event.harnessSessionId
    : event.agentHarness;

  return (
    <EventRow
      type="agent.sessionResumeRequested"
      badgeText="Reconnect Requested"
      badgeColor="info"
      primaryInfo={event.role}
      secondaryInfo={truncatedSessionId}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentSessionResumeRequestedDetails(
  event: AgentSessionResumeRequestedEvent
): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Session Reconnect Requested"
      timestamp={event.timestamp}
      type="agent.sessionResumeRequested"
    >
      <DetailRow label="Role" value={event.role} />
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Harness" value={event.agentHarness} />
      {event.harnessSessionId && (
        <DetailRow label="Harness Session ID" value={event.harnessSessionId} mono />
      )}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Session Resumed ────────────────────────────────────────────────────

function renderAgentSessionResumedCell(
  event: AgentSessionResumedEvent,
  isSelected: boolean
): React.ReactNode {
  const truncatedSessionId = event.harnessSessionId
    ? event.harnessSessionId.length > 60
      ? event.harnessSessionId.substring(0, 57) + '...'
      : event.harnessSessionId
    : undefined;

  return (
    <EventRow
      type="agent.sessionResumed"
      badgeText="Session Reconnected"
      badgeColor="success"
      primaryInfo={event.role}
      secondaryInfo={truncatedSessionId}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentSessionResumedDetails(event: AgentSessionResumedEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Session Reconnected"
      timestamp={event.timestamp}
      type="agent.sessionResumed"
    >
      <DetailRow label="Role" value={event.role} />
      <MachineDetailRow machineId={event.machineId} />
      {event.harnessSessionId && (
        <DetailRow label="Harness Session ID" value={event.harnessSessionId} mono />
      )}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Session Resume Failed ──────────────────────────────────────────────

function renderAgentSessionResumeFailedCell(
  event: AgentSessionResumeFailedEvent,
  isSelected: boolean
): React.ReactNode {
  const truncatedReason =
    event.reason.length > 60 ? event.reason.substring(0, 57) + '...' : event.reason;
  return (
    <EventRow
      type="agent.sessionResumeFailed"
      badgeText="Reconnect Failed"
      badgeColor="warning"
      primaryInfo={event.role}
      secondaryInfo={truncatedReason}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentSessionResumeFailedDetails(
  event: AgentSessionResumeFailedEvent
): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Session Reconnect Failed"
      timestamp={event.timestamp}
      type="agent.sessionResumeFailed"
    >
      <DetailRow label="Role" value={event.role} />
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Reason" value={event.reason} />
      {event.harnessSessionId && (
        <DetailRow label="Harness Session ID" value={event.harnessSessionId} mono />
      )}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent Session Reopen Retry ───────────────────────────────────────────────

function renderAgentSessionReopenRetryCell(
  event: AgentSessionReopenRetryEvent,
  isSelected: boolean
): React.ReactNode {
  const attemptLabel = `${event.attempt}/${event.maxAttempts}`;
  const secondary = event.error ? `${attemptLabel} — ${event.error}` : attemptLabel;
  return (
    <EventRow
      type="agent.sessionReopenRetry"
      badgeText="Reopen Retry"
      badgeColor="info"
      primaryInfo={event.role}
      secondaryInfo={secondary}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAgentSessionReopenRetryDetails(
  event: AgentSessionReopenRetryEvent
): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Session Reopen Retry"
      timestamp={event.timestamp}
      type="agent.sessionReopenRetry"
    >
      <DetailRow label="Role" value={event.role} />
      <MachineDetailRow machineId={event.machineId} />
      <DetailRow label="Attempt" value={`${event.attempt} of ${event.maxAttempts}`} />
      {event.error && <DetailRow label="Previous Error" value={event.error} />}
      {event.harnessSessionId && (
        <DetailRow label="Harness Session ID" value={event.harnessSessionId} mono />
      )}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Machine Switched ─────────────────────────────────────────────────────────

function renderMachineSwitchedCell(
  event: MachineSwitchedEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="machine.switched"
      badgeText="Switched"
      badgeColor="info"
      primaryInfo={event.role}
      secondaryInfo={event.newMachineId}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderMachineSwitchedDetails(event: MachineSwitchedEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Machine Switched"
      timestamp={event.timestamp}
      type="machine.switched"
    >
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Previous Machine" value={event.previousMachineId} mono />
      <DetailRow label="New Machine" value={event.newMachineId} mono />
      <DetailRow label="Reason" value={event.reason} />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Agent event definitions ────────────────────────────────────────────────────

export const agentEventDefinitions: Pick<
  EventTypeRegistry,
  | 'agent.started'
  | 'agent.exited'
  | 'agent.circuitOpen'
  | 'agent.requestStart'
  | 'agent.requestStop'
  | 'agent.registered'
  | 'agent.waiting'
  | 'agent.startFailed'
  | 'agent.restartLimitReached'
  | 'agent.sessionResumeRequested'
  | 'agent.sessionResumed'
  | 'agent.sessionResumeFailed'
  | 'agent.sessionReopenRetry'
  | 'agent.resumeStormAborted'
  | 'machine.switched'
> = {
  'agent.started': {
    cellRenderer: renderAgentStartedCell,
    detailsRenderer: renderAgentStartedDetails,
  },
  'agent.exited': {
    cellRenderer: renderAgentExitedCell,
    detailsRenderer: renderAgentExitedDetails,
  },
  'agent.circuitOpen': {
    cellRenderer: renderAgentCircuitOpenCell,
    detailsRenderer: renderAgentCircuitOpenDetails,
  },
  'agent.requestStart': {
    cellRenderer: renderAgentRequestStartCell,
    detailsRenderer: renderAgentRequestStartDetails,
  },
  'agent.requestStop': {
    cellRenderer: renderAgentRequestStopCell,
    detailsRenderer: renderAgentRequestStopDetails,
  },
  'agent.registered': {
    cellRenderer: renderAgentRegisteredCell,
    detailsRenderer: renderAgentRegisteredDetails,
  },
  'agent.waiting': {
    cellRenderer: renderAgentWaitingCell,
    detailsRenderer: renderAgentWaitingDetails,
  },
  'agent.startFailed': {
    cellRenderer: renderAgentStartFailedCell,
    detailsRenderer: renderAgentStartFailedDetails,
  },
  'agent.restartLimitReached': {
    cellRenderer: renderAgentRestartLimitReachedCell,
    detailsRenderer: renderAgentRestartLimitReachedDetails,
  },
  'agent.sessionResumeRequested': {
    cellRenderer: renderAgentSessionResumeRequestedCell,
    detailsRenderer: renderAgentSessionResumeRequestedDetails,
  },
  'agent.sessionResumed': {
    cellRenderer: renderAgentSessionResumedCell,
    detailsRenderer: renderAgentSessionResumedDetails,
  },
  'agent.sessionResumeFailed': {
    cellRenderer: renderAgentSessionResumeFailedCell,
    detailsRenderer: renderAgentSessionResumeFailedDetails,
  },
  'agent.sessionReopenRetry': {
    cellRenderer: renderAgentSessionReopenRetryCell,
    detailsRenderer: renderAgentSessionReopenRetryDetails,
  },
  'agent.resumeStormAborted': {
    cellRenderer: renderAgentResumeStormAbortedCell,
    detailsRenderer: renderAgentResumeStormAbortedDetails,
  },
  'machine.switched': {
    cellRenderer: renderMachineSwitchedCell,
    detailsRenderer: renderMachineSwitchedDetails,
  },
};
