/**
 * useDaemonConnectivity — per-machine daemon status subscriptions.
 *
 * Returns a Map<machineId, { connected: boolean; lastSeenAt: number }> for a
 * list of machine IDs. Uses a single batch subscription (getDaemonStatusesBatch)
 * instead of 10 fixed-slot queries, reducing Convex subscription churn.
 *
 * Supports up to MAX_MACHINES machines.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

/** Connectivity result for a single machine. */
export interface MachineConnectivity {
  connected: boolean;
  lastSeenAt: number;
}

/** Maximum number of machines supported by this hook. */
const MAX_MACHINES = 10;

/**
 * Returns daemon connectivity info for up to MAX_MACHINES machines.
 * Each entry in the returned Map is updated reactively when the daemon heartbeats.
 *
 * @param machineIds - List of machine IDs to subscribe to. Order doesn't matter.
 */
export function useDaemonConnectivity(machineIds: string[]): Map<string, MachineConnectivity> {
  const stableIds = useMemo(() => machineIds.slice(0, MAX_MACHINES), [machineIds]);

  const batch = useSessionQuery(
    api.machines.getDaemonStatusesBatch,
    stableIds.length > 0 ? { machineIds: stableIds } : 'skip'
  );

  return useMemo(() => {
    const map = new Map<string, MachineConnectivity>();
    if (!batch) {
      for (const id of stableIds) {
        map.set(id, { connected: false, lastSeenAt: 0 });
      }
      return map;
    }
    for (const row of batch.statuses) {
      map.set(row.machineId, {
        connected: row.connected,
        lastSeenAt: row.lastSeenAt ?? 0,
      });
    }
    return map;
  }, [batch, stableIds]);
}
