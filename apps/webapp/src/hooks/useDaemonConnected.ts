/**
 * Hook to check if a machine's daemon is connected, queried via Convex.
 *
 * Replaces the localhost-based `useLocalDaemon` hook to work around Safari's
 * mixed-content blocking of http://localhost from HTTPS production pages.
 *
 * Reads the materialized machine status maintained by daemon heartbeat and
 * lifecycle events.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';

/** Result from the daemon status query. */
export interface UseDaemonConnectedResult {
  /** Whether the materialized machine status is online. */
  isConnected: boolean;
  /** true while the initial query is loading. */
  isLoading: boolean;
}

/**
 * Query Convex for the daemon's connectivity status for a given machine.
 *
 * @param machineId - The machine UUID to check, or null if unknown
 * @returns Whether the machine's materialized daemon status is online
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

  return {
    isConnected: result.connected,
    isLoading: false,
  };
}
