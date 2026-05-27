/**
 * useDaemonConnectivity — per-machine daemon status subscriptions.
 *
 * Returns a Map<machineId, { connected: boolean; lastSeenAt: number }> for a
 * list of machine IDs. Each machine subscribes to getDaemonStatus independently
 * so that heartbeat invalidations remain small (per-machine, few bytes each)
 * and never cascade into the heavier listMachines subscription.
 *
 * Supports up to MAX_MACHINES machines via fixed-slot queries.
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

/** Sentinel value for skipped slots. */
const SKIP = 'skip' as const;

/**
 * Returns daemon connectivity info for up to MAX_MACHINES machines.
 * Each entry in the returned Map is updated reactively when the daemon heartbeats.
 *
 * @param machineIds - List of machine IDs to subscribe to. Order doesn't matter.
 */
export function useDaemonConnectivity(
  machineIds: string[]
): Map<string, MachineConnectivity> {
  // Pad to MAX_MACHINES fixed slots so hooks are called unconditionally.
  const slots = useMemo(() => {
    const padded: Array<{ machineId: string } | typeof SKIP> = [];
    for (let i = 0; i < MAX_MACHINES; i++) {
      padded.push(i < machineIds.length ? { machineId: machineIds[i] } : SKIP);
    }
    return padded;
  }, [machineIds]);

  // One query per fixed slot — hook count is constant regardless of machineIds.length.
  /* eslint-disable react-hooks/rules-of-hooks */
  const r0 = useSessionQuery(api.machines.getDaemonStatus, slots[0]);
  const r1 = useSessionQuery(api.machines.getDaemonStatus, slots[1]);
  const r2 = useSessionQuery(api.machines.getDaemonStatus, slots[2]);
  const r3 = useSessionQuery(api.machines.getDaemonStatus, slots[3]);
  const r4 = useSessionQuery(api.machines.getDaemonStatus, slots[4]);
  const r5 = useSessionQuery(api.machines.getDaemonStatus, slots[5]);
  const r6 = useSessionQuery(api.machines.getDaemonStatus, slots[6]);
  const r7 = useSessionQuery(api.machines.getDaemonStatus, slots[7]);
  const r8 = useSessionQuery(api.machines.getDaemonStatus, slots[8]);
  const r9 = useSessionQuery(api.machines.getDaemonStatus, slots[9]);
  /* eslint-enable react-hooks/rules-of-hooks */

  const results = [r0, r1, r2, r3, r4, r5, r6, r7, r8, r9];

  return useMemo(() => {
    const map = new Map<string, MachineConnectivity>();
    for (let i = 0; i < machineIds.length && i < MAX_MACHINES; i++) {
      const result = results[i];
      if (result !== undefined) {
        map.set(machineIds[i], {
          connected: result.connected,
          lastSeenAt: result.lastSeenAt ?? 0,
        });
      } else {
        // Loading — report disconnected optimistically
        map.set(machineIds[i], { connected: false, lastSeenAt: 0 });
      }
    }
    return map;
    // results intentionally not in deps to avoid re-running when refs change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineIds, r0, r1, r2, r3, r4, r5, r6, r7, r8, r9]);
}
