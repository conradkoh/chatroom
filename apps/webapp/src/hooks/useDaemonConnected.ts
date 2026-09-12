/**
 * Hook to check if a machine's daemon is connected, queried via Convex.
 *
 * Replaces the localhost-based `useLocalDaemon` hook to work around Safari's
 * mixed-content blocking of http://localhost from HTTPS production pages.
 *
 * Reads the thin machine status and liveness read models maintained by the
 * daemon heartbeat and lifecycle events.
 */

'use client';

import { DAEMON_HEARTBEAT_TTL_MS } from '@workspace/backend/config/reliability';
import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';

/** Result from the daemon status query. */
export interface UseDaemonConnectedResult {
  /** Whether the daemon is connected and recently seen. */
  isConnected: boolean;
  /** true while the initial query is loading. */
  isLoading: boolean;
}

/**
 * Staleness threshold in milliseconds.
 * If lastSeenAt is older than this, we consider the daemon disconnected
 * even if the status model is still online (in case of an unclean shutdown).
 */
const STALENESS_THRESHOLD_MS = DAEMON_HEARTBEAT_TTL_MS;

/**
 * Query Convex for the daemon's connectivity status for a given machine.
 *
 * @param machineId - The machine UUID to check, or null if unknown
 * @returns Whether the daemon is connected and recently seen
 *
 * @example
 * ```tsx
 * const { isConnected } = useDaemonConnected(workspace.machineId);
 * if (isConnected) {
 *   return <button onClick={handleOpenVSCode}>Open in VS Code</button>;
 * }
 * ```
 */
export function useDaemonConnected(machineId: string | null): UseDaemonConnectedResult {
  const result = useSessionQuery(api.machines.getDaemonStatus, machineId ? { machineId } : 'skip');

  if (result === undefined) {
    return { isConnected: false, isLoading: true };
  }

  const { connected, lastSeenAt } = result;

  // Check for staleness: if heartbeat is too old, treat as disconnected
  if (connected && lastSeenAt) {
    const age = Date.now() - lastSeenAt;
    if (age > STALENESS_THRESHOLD_MS) {
      return { isConnected: false, isLoading: false };
    }
  }

  return {
    isConnected: connected,
    isLoading: false,
  };
}
