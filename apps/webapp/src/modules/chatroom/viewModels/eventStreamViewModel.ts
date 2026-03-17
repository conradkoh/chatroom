/**
 * Shared types and utilities for the event stream feature.
 * Used by both MessageFeed and EventStreamModal.
 */

// ─── Canonical event type ─────────────────────────────────────────────────────

/**
 * Canonical shape for a single chatroom event stream entry.
 * Both `timestamp` and `_creationTime` are present — EventRow uses
 * `event.timestamp ?? event._creationTime` as the display time.
 */
export interface EventStreamEvent {
  _id: string;
  _creationTime: number;
  type: string;
  role?: string;
  timestamp: number;
}

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
