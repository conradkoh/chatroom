/**
 * Shared types and utilities for the event stream feature.
 * Used by both MessageFeed and EventStreamModal.
 */

// ─── Event Type Name Union ───────────────────────────────────────────────────

/**
 * Union of all event type strings used in the registry.
 */
export type EventTypeName =
  | 'agent.started'
  | 'agent.exited'
  | 'agent.circuitOpen'
  | 'agent.requestStart'
  | 'agent.requestStop'
  | 'agent.registered'
  | 'agent.waiting'
  | 'task.activated'
  | 'task.acknowledged'
  | 'task.inProgress'
  | 'task.completed'
  | 'skill.activated'
  | 'daemon.ping'
  | 'daemon.pong'
  | 'daemon.gitRefresh'
  | 'config.requestRemoval';

// ─── Base Event Interface ─────────────────────────────────────────────────────

/**
 * Base shape for a single chatroom event stream entry.
 * Both `timestamp` and `_creationTime` are present — EventRow uses
 * `event.timestamp ?? event._creationTime` as the display time.
 */
export interface EventStreamEventBase {
  _id: string;
  _creationTime: number;
  timestamp: number;
}

// ─── Agent Event Types ────────────────────────────────────────────────────────

export interface AgentStartedEvent extends EventStreamEventBase {
  type: 'agent.started';
  role: string;
  machineId: string;
  agentHarness: string;
  model: string;
  workingDir: string;
  pid: number;
  reason?: string;
  chatroomId: string;
}

export interface AgentExitedEvent extends EventStreamEventBase {
  type: 'agent.exited';
  role: string;
  machineId: string;
  pid: number;
  intentional: boolean;
  stopReason?: string;
  stopSignal?: string;
  exitCode?: number;
  signal?: string;
  chatroomId: string;
}

export interface AgentCircuitOpenEvent extends EventStreamEventBase {
  type: 'agent.circuitOpen';
  role: string;
  machineId: string;
  reason: string;
  chatroomId: string;
}

export interface AgentRequestStartEvent extends EventStreamEventBase {
  type: 'agent.requestStart';
  role: string;
  machineId: string;
  agentHarness: string;
  model: string;
  workingDir: string;
  reason: string;
  deadline: number;
  chatroomId: string;
}

export interface AgentRequestStopEvent extends EventStreamEventBase {
  type: 'agent.requestStop';
  role: string;
  machineId: string;
  reason: string;
  deadline: number;
  chatroomId: string;
}

export interface AgentRegisteredEvent extends EventStreamEventBase {
  type: 'agent.registered';
  role: string;
  agentType: string;
  machineId?: string;
  chatroomId: string;
}

export interface AgentWaitingEvent extends EventStreamEventBase {
  type: 'agent.waiting';
  role: string;
  machineId?: string;
  chatroomId: string;
}

// ─── Task Event Types ────────────────────────────────────────────────────────

export interface TaskActivatedEvent extends EventStreamEventBase {
  type: 'task.activated';
  role: string;
  taskId: string;
  taskStatus: string;
  taskContent: string;
  machineId?: string;
  chatroomId: string;
}

export interface TaskAcknowledgedEvent extends EventStreamEventBase {
  type: 'task.acknowledged';
  role: string;
  taskId: string;
  chatroomId: string;
}

export interface TaskInProgressEvent extends EventStreamEventBase {
  type: 'task.inProgress';
  role: string;
  taskId: string;
  chatroomId: string;
}

export interface TaskCompletedEvent extends EventStreamEventBase {
  type: 'task.completed';
  role: string;
  taskId: string;
  finalStatus: string;
  machineId?: string;
  skipAgentStatusUpdate?: boolean;
  chatroomId: string;
}

// ─── Skill Event Types ───────────────────────────────────────────────────────

export interface SkillActivatedEvent extends EventStreamEventBase {
  type: 'skill.activated';
  role: string;
  skillId: string;
  skillName: string;
  chatroomId: string;
  prompt: string;
}

// ─── Config Event Types ──────────────────────────────────────────────────────

export interface ConfigRequestRemovalEvent extends EventStreamEventBase {
  type: 'config.requestRemoval';
  role: string;
  machineId: string;
  reason: string;
  chatroomId: string;
}

// ─── Daemon Event Types ──────────────────────────────────────────────────────

export interface DaemonPingEvent extends EventStreamEventBase {
  type: 'daemon.ping';
  machineId: string;
}

export interface DaemonPongEvent extends EventStreamEventBase {
  type: 'daemon.pong';
  machineId: string;
  pingEventId: string;
}

export interface DaemonGitRefreshEvent extends EventStreamEventBase {
  type: 'daemon.gitRefresh';
  machineId: string;
  workingDir: string;
}

// ─── Event Stream Event Union ────────────────────────────────────────────────

/**
 * Union of all event types. Use this as the canonical event type
 * for event stream entries.
 */
export type EventStreamEvent =
  | AgentStartedEvent
  | AgentExitedEvent
  | AgentCircuitOpenEvent
  | AgentRequestStartEvent
  | AgentRequestStopEvent
  | AgentRegisteredEvent
  | AgentWaitingEvent
  | TaskActivatedEvent
  | TaskAcknowledgedEvent
  | TaskInProgressEvent
  | TaskCompletedEvent
  | SkillActivatedEvent
  | ConfigRequestRemovalEvent
  | DaemonPingEvent
  | DaemonPongEvent
  | DaemonGitRefreshEvent;

// ─── Formatters ───────────────────────────────────────────────────────────────

/** Human-readable label for each event type. Falls back to the raw type string. */
export function formatEventType(type: string): string {
  const labels: Record<string, string> = {
    'agent.started': 'Agent Started',
    'agent.exited': 'Agent Exited',
    'agent.registered': 'Agent Registered',
    'agent.waiting': 'Agent Waiting',
    'agent.circuitOpen': 'Circuit Open',
    'agent.requestStart': 'Agent Request Start',
    'agent.requestStop': 'Agent Request Stop',
    'task.activated': 'Task Activated',
    'task.acknowledged': 'Task Acknowledged',
    'task.inProgress': 'Task In Progress',
    'task.completed': 'Task Completed',
    'skill.activated': 'Skill Activated',
    'daemon.ping': 'Daemon Ping',
    'daemon.pong': 'Daemon Pong',
    'daemon.gitRefresh': 'Git Refresh',
    'config.requestRemoval': 'Config Request Removal',
  };
  return labels[type] ?? type;
}

/** Returns the Tailwind text color class for an event type's badge. */
export function getEventBadgeTextColor(type: string): string {
  const colorMap: Record<string, string> = {
    'agent.started': 'text-chatroom-status-success',
    'agent.registered': 'text-chatroom-status-success',
    'agent.exited': 'text-chatroom-status-error',
    'agent.circuitOpen': 'text-chatroom-status-error',
    'agent.waiting': 'text-chatroom-status-warning',
    'agent.requestStart': 'text-chatroom-status-info',
    'agent.requestStop': 'text-chatroom-status-warning',
    'task.activated': 'text-chatroom-status-success',
    'task.acknowledged': 'text-chatroom-status-success',
    'task.inProgress': 'text-chatroom-status-info',
    'task.completed': 'text-chatroom-status-success',
    'skill.activated': 'text-chatroom-status-purple',
    'daemon.ping': 'text-chatroom-text-muted',
    'daemon.pong': 'text-chatroom-text-muted',
    'daemon.gitRefresh': 'text-chatroom-text-muted',
    'config.requestRemoval': 'text-chatroom-status-warning',
  };
  return colorMap[type] ?? 'text-chatroom-status-info';
}

/** Format a Unix millisecond timestamp as HH:MM:SS (24-hour). */
export function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Format a Unix millisecond timestamp with full date and time. */
export function formatTimestampFull(ms: number): string {
  const date = new Date(ms);
  const dateStr = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${dateStr} ${timeStr}`;
}
