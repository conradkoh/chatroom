/** Daemon-side normalized command event from the machine command inbox. */
export const DAEMON_COMMAND_EVENT_TYPES = [
  'agent.requestStart',
  'agent.restart',
  'agent.requestStop',
  'daemon.ping',
  'daemon.gitRefresh',
  'daemon.localAction',
  'daemon.pickFolder',
  'daemon.refreshCapabilities',
] as const;

export type DaemonCommandEventType = (typeof DAEMON_COMMAND_EVENT_TYPES)[number];

export function isDaemonCommandEventType(value: string): value is DaemonCommandEventType {
  return (DAEMON_COMMAND_EVENT_TYPES as readonly string[]).includes(value);
}

/** Base fields present on all command events from getCommandEvents. */
export interface CommandEventBase {
  commandId: string; // Convex _id as string
  machineId: string;
  type: DaemonCommandEventType;
  deadline: number;
  timestamp: number;
}

export interface AgentRequestStartCommandEvent extends CommandEventBase {
  type: 'agent.requestStart';
  chatroomId: string;
  role: string;
  agentHarness: string;
  model: string;
  workingDir: string;
  reason: string;
  wantResume?: boolean;
}

export interface AgentRequestRestartCommandEvent extends CommandEventBase {
  type: 'agent.restart';
  chatroomId: string;
  role: string;
  reason: string;
}

export interface AgentRequestStopCommandEvent extends CommandEventBase {
  type: 'agent.requestStop';
  chatroomId: string;
  role: string;
  reason: string;
}

export interface DaemonPingCommandEvent extends CommandEventBase {
  type: 'daemon.ping';
}

export interface DaemonGitRefreshCommandEvent extends CommandEventBase {
  type: 'daemon.gitRefresh';
  workingDir: string;
}

export interface DaemonLocalActionCommandEvent extends CommandEventBase {
  type: 'daemon.localAction';
  action: string;
  payload?: Record<string, unknown>;
}

export interface DaemonPickFolderCommandEvent extends CommandEventBase {
  type: 'daemon.pickFolder';
}

export interface DaemonRefreshCapabilitiesCommandEvent extends CommandEventBase {
  type: 'daemon.refreshCapabilities';
}

export type CommandEvent =
  | AgentRequestStartCommandEvent
  | AgentRequestRestartCommandEvent
  | AgentRequestStopCommandEvent
  | DaemonPingCommandEvent
  | DaemonGitRefreshCommandEvent
  | DaemonLocalActionCommandEvent
  | DaemonPickFolderCommandEvent
  | DaemonRefreshCapabilitiesCommandEvent;

export function isCommandEvent(value: unknown): value is CommandEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && isDaemonCommandEventType(type);
}
