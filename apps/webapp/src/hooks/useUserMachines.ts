/**
 * Hook for the narrow machine registry owned by the current user.
 *
 * Reads the cold chatroom_machines table only — no daemon-fed capabilities or
 * status tables — so the subscription stays quiet unless a machine is
 * registered, renamed, or removed. Daemon connectivity and harness/model
 * capabilities are served by separate narrow queries (useDaemonConnectivity,
 * useMachineCapabilities) to keep concerns separated.
 *
 * Keep this hook tiny — single thin wrapper. No fixed-slot or batch patterns.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';

import type { UserMachine } from '@/modules/chatroom/types/machine';

export interface UseUserMachinesResult {
  /** Cold registry machines for the current user (narrow: metadata only). */
  machines: UserMachine[];
  /** True while the initial registry query is loading. */
  isLoading: boolean;
}

/** Returns the narrow registration list for all machines of the current user. */
export function useUserMachines(): UseUserMachinesResult {
  const result = useSessionQuery(api.machines.getUserMachines);
  return {
    machines: result?.machines ?? [],
    isLoading: result === undefined,
  };
}
