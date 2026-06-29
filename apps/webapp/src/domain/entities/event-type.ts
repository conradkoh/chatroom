/**
 * Domain Entity: EventType
 *
 * Canonical event type names and metadata for the chatroom event stream UI.
 * Mirrors Convex `chatroom_eventStream` variants surfaced in the frontend.
 *
 * Presentation helpers (labels in context, Tailwind badge classes) live in
 * `modules/chatroom/viewModels/eventStreamViewModel.ts`.
 */

export type EventBadgeVariant = 'info' | 'success' | 'warning' | 'error' | 'muted' | 'purple';

export type SupportedEventTypeMeta = {
  label: string;
  badge: EventBadgeVariant;
};

/**
 * All event types the event stream UI supports.
 * Keys must stay in sync with Convex `chatroom_eventStream` variants we render.
 */
export const SUPPORTED_EVENT_TYPES = {
  'agent.started': { label: 'Agent Started', badge: 'success' },
  'agent.exited': { label: 'Agent Exited', badge: 'error' },
  'agent.circuitOpen': { label: 'Circuit Open', badge: 'warning' },
  'agent.requestStart': { label: 'Agent Request Start', badge: 'warning' },
  'agent.requestStop': { label: 'Agent Request Stop', badge: 'error' },
  'agent.registered': { label: 'Agent Registered', badge: 'success' },
  'agent.waiting': { label: 'Agent Waiting', badge: 'success' },
  'agent.startFailed': { label: 'Agent Start Failed', badge: 'error' },
  'agent.sessionResumeRequested': { label: 'Session Reconnect Requested', badge: 'info' },
  'agent.sessionResumed': { label: 'Session Reconnected', badge: 'success' },
  'agent.sessionResumeFailed': { label: 'Session Reconnect Failed', badge: 'warning' },
  'agent.sessionReopenRetry': { label: 'Session Reopen Retry', badge: 'info' },
  'agent.sessionCompacted': { label: 'Session Compacted', badge: 'info' },
  'agent.resumeStormAborted': { label: 'Resume Storm Aborted', badge: 'error' },
  'agent.restartLimitReached': { label: 'Agent Restart Limit', badge: 'error' },
  'machine.switched': { label: 'Machine Switched', badge: 'info' },
  'task.activated': { label: 'Task Activated', badge: 'success' },
  'task.acknowledged': { label: 'Task Acknowledged', badge: 'success' },
  'task.inProgress': { label: 'Task In Progress', badge: 'info' },
  'task.completed': { label: 'Task Completed', badge: 'success' },
  'skill.activated': { label: 'Skill Activated', badge: 'purple' },
  'daemon.ping': { label: 'Daemon Ping', badge: 'muted' },
  'daemon.pong': { label: 'Daemon Pong', badge: 'muted' },
  'daemon.gitRefresh': { label: 'Git Refresh', badge: 'muted' },
  'daemon.refreshCapabilities': { label: 'Capabilities Refresh', badge: 'muted' },
  'daemon.localAction': { label: 'Local Action', badge: 'muted' },
  'config.requestRemoval': { label: 'Config Request Removal', badge: 'warning' },
  'command.run': { label: 'Command Run', badge: 'warning' },
  'command.stop': { label: 'Command Stop', badge: 'error' },
} as const satisfies Record<string, SupportedEventTypeMeta>;

export type EventTypeName = keyof typeof SUPPORTED_EVENT_TYPES;

export const SUPPORTED_EVENT_TYPE_NAMES = Object.keys(SUPPORTED_EVENT_TYPES) as EventTypeName[];

export function isSupportedEventType(type: string): type is EventTypeName {
  return type in SUPPORTED_EVENT_TYPES;
}
