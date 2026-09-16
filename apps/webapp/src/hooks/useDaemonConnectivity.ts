/**
 * useDaemonConnectivity — daemon connectivity for all of the user's machines.
 *
 * Uses one stable session-only subscription instead of a machineIds-array batch
 * that resubscribed whenever the array identity changed.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

/** Connectivity result for a single machine. */
export interface MachineConnectivity {
  connected: boolean;
}

/**
 * Returns daemon connectivity info for all machines of the current user.
 * Entries are absent while loading; consumers already treat missing as disconnected.
 */
export function useDaemonConnectivity(): Map<string, MachineConnectivity> {
  const result = useSessionQuery(api.machines.listMachineConnectivity);

  return useMemo(() => {
    const map = new Map<string, MachineConnectivity>();
    for (const row of result?.machines ?? []) {
      map.set(row.machineId, { connected: row.connected });
    }
    return map;
  }, [result]);
}
