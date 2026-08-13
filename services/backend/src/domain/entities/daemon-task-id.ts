/** Canonical client-allocated task identity (UUID v4). Convex rows store this as `daemonTaskId`. */
export type DaemonTaskId = string & { readonly __brand: 'DaemonTaskId' };

const DAEMON_TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Type guard: true when `value` matches the daemon task ID convention. */
export function isDaemonTaskId(value: string): value is DaemonTaskId {
  return DAEMON_TASK_ID_PATTERN.test(value);
}

/** Assert a string is a valid daemon task ID; throws on invalid input. */
export function asDaemonTaskId(value: string): DaemonTaskId {
  if (!isDaemonTaskId(value)) {
    throw new Error(`Invalid DaemonTaskId: ${value}`);
  }
  return value;
}

/** Allocate a new client-originated task ID (UUID v4). */
export function createDaemonTaskId(): DaemonTaskId {
  return crypto.randomUUID() as DaemonTaskId;
}

/** @deprecated Use `isDaemonTaskId` instead. */
export const isDaemonLocalTaskId = isDaemonTaskId;
export function resolveCanonicalTaskId(task: { _id: string; daemonTaskId?: string | null }): string {
  return task.daemonTaskId && isDaemonTaskId(task.daemonTaskId) ? task.daemonTaskId : task._id;
}
