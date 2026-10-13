'use client';

import { useMemo } from 'react';

import { useDaemonConnectivity } from '@/hooks/useDaemonConnectivity';
import { useUserMachines } from '@/hooks/useUserMachines';
import type { UserMachine } from '@/modules/chatroom/types/machine';

export interface UseConnectedMachinesResult {
  /** Every registered machine, connected or not. */
  machines: UserMachine[];
  /** The machines whose daemon is connected. The only machines that can be picked for work. */
  connectedMachines: UserMachine[];
  connectedMachineIds: ReadonlySet<string>;
  /** True while the machine registry is loading. */
  isLoading: boolean;
}

/**
 * The user's machines split by daemon connectivity. Every setup surface uses this one rule, so a
 * machine is "connected" in the same way everywhere.
 */
export function useConnectedMachines(): UseConnectedMachinesResult {
  const { machines, isLoading } = useUserMachines();
  const connectivity = useDaemonConnectivity();

  const connectedMachineIds = useMemo(
    () =>
      new Set(
        machines
          .filter((machine) => connectivity.get(machine.machineId)?.connected === true)
          .map((machine) => machine.machineId)
      ),
    [machines, connectivity]
  );
  const connectedMachines = useMemo(
    () => machines.filter((machine) => connectedMachineIds.has(machine.machineId)),
    [machines, connectedMachineIds]
  );

  return { machines, connectedMachines, connectedMachineIds, isLoading };
}
