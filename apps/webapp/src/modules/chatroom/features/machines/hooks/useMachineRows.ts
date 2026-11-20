/**
 * Composes the machine registry (cold) with connectivity, last-seen and usage
 * subscriptions (hot) into rows for the Machines page.
 *
 * Ordering only depends on registry fields (display name, registeredAt,
 * machineId) so daemon heartbeats never reshuffle cards. Only the registry
 * query drives the page-level loading state; every other field degrades per row.
 */

'use client';

import { useMemo } from 'react';

import { getMachineDisplayName, type UserMachine } from '../../../types/machine';
import { sortMachinesByDisplayName } from '../lib/machineDisplay';

import { useDaemonConnectivity } from '@/hooks/useDaemonConnectivity';
import { useMachineLastSeen } from '@/hooks/useMachineLastSeen';
import type { MachineUsage } from '@/hooks/useMachineUsage';
import { useMachineUsage } from '@/hooks/useMachineUsage';
import { useUserMachines } from '@/hooks/useUserMachines';

export interface MachineRowModel {
  machine: UserMachine;
  /** alias || hostname */
  displayName: string;
  /** undefined until connectivity resolves for this machine. */
  connected: boolean | undefined;
  /** undefined while loading, null = unknown / online. */
  lastSeenAt: number | null | undefined;
  /** undefined while loading. */
  usage: MachineUsage | undefined;
}

export function useMachineRows(): { rows: MachineRowModel[]; isLoading: boolean } {
  const { machines, isLoading } = useUserMachines();
  const connectivity = useDaemonConnectivity();
  const lastSeen = useMachineLastSeen();
  const usage = useMachineUsage();

  const rows = useMemo(
    () =>
      sortMachinesByDisplayName(machines).map((machine) => ({
        machine,
        displayName: getMachineDisplayName(machine),
        connected: connectivity.get(machine.machineId)?.connected,
        lastSeenAt: lastSeen.get(machine.machineId),
        usage: usage.get(machine.machineId),
      })),
    [machines, connectivity, lastSeen, usage]
  );

  return { rows, isLoading };
}
