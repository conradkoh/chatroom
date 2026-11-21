/**
 * useMachineLastSeen — last-seen timestamps for the user's OFFLINE machines.
 *
 * The backend never reads liveness for online machines, so online entries come
 * back as `lastSeenAt: null` (meaning "unknown / online"). Entries are absent
 * until the query resolves.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

/** machineId → last seen ms; null when online or when no liveness record exists. Empty Map until loaded. */
export function useMachineLastSeen(): Map<string, number | null> {
  const result = useSessionQuery(api.machines.listMachineLastSeen);

  return useMemo(
    () => new Map((result?.machines ?? []).map((m) => [m.machineId, m.lastSeenAt])),
    [result]
  );
}
